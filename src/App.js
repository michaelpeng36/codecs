import { useState, useEffect, useRef } from 'react';
import { createFile } from 'mp4box';
import url from './assets/render-136381179-1724250411493.mp4'

export default function VideoPlayer() {
  const canvasRef = useRef(null);
  const decoderRef = useRef(null);
  const [error, setError] = useState(null);
  const [frame, setFrame] = useState(0);
  const [debug, setDebug] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const mp4boxFileRef = useRef(null);
  const samplesRef = useRef([]);
  const keyFramesRef = useRef([]);

  function handleVideoForward() {
    setFrame(frame => frame + 1);
  }
  function handleVideoBackward() {
    setFrame(frame => Math.max(0, frame - 1));
  }

  return (
    <>
      <div className="display">
        <VideoFrameDisplay
          frame={frame}
          canvasRef={canvasRef}
          decoderRef={decoderRef}
          videoInfo={videoInfo}
          setVideoInfo={setVideoInfo}
          error={error}
          setError={setError}
          debug={debug}
          setDebug={setDebug}
          mp4boxFileRef={mp4boxFileRef}
          samplesRef={samplesRef}
          keyFramesRef={keyFramesRef}
        />
      </div>
      <div className="control">
        <ControlBar frame={frame} setFrame={setFrame} onForwardClick={handleVideoForward} onBackWardClick={handleVideoBackward} />
      </div>
    </>
  );
}

const VideoFrameDisplay = ({ frame, canvasRef, decoderRef, videoInfo, setVideoInfo, error, setError, debug, setDebug, mp4boxFileRef, samplesRef, keyFramesRef }) => {
  const addDebug = (message) => {
    setDebug(prev => prev + '\n' + message);
  };

  useEffect(() => {
    const initializeVideo = async () => {
      try {
        const mp4boxFile = createFile();
        mp4boxFileRef.current = mp4boxFile;
        let filePosition = 0;

        const findAvcC = (trak) => {
          if (trak.mdia?.minf?.stbl?.stsd) {
            const stsd = trak.mdia.minf.stbl.stsd;
            for (let i = 0; i < stsd.entries.length; i++) {
              const entry = stsd.entries[i];
              if (entry.avcC) {
                return entry.avcC;
              }
            }
          }
          return null;
        };

        const initializeDecoder = async (info) => {
          const videoTrackInfo = info.tracks.find(track => track.type === 'video');
          if (!videoTrackInfo) {
            throw new Error('No video track found in the file.');
          }

          addDebug(`Video codec: ${videoTrackInfo.codec}`);

          let avcC = null;
          if (videoTrackInfo.codec.startsWith('avc1')) {
            for (let i = 0; i < mp4boxFile.moov.traks.length; i++) {
              avcC = findAvcC(mp4boxFile.moov.traks[i]);
              if (avcC) break;
            }
            if (!avcC) {
              addDebug('AVC configuration not found in expected location');
              throw new Error('AVC configuration not found');
            }
          }

          let codecConfig;
          if (videoTrackInfo.codec.startsWith('avc1')) {
            if (!avcC.SPS || !avcC.SPS[0] || !avcC.PPS || !avcC.PPS[0]) {
              throw new Error('Invalid AVC configuration structure');
            }
            const sps = new Uint8Array(Object.values(avcC.SPS[0].nalu));
            const pps = new Uint8Array(Object.values(avcC.PPS[0].nalu));
            const avccBox = new Uint8Array([
              0x01, avcC.AVCProfileIndication, avcC.profile_compatibility, avcC.AVCLevelIndication,
              0xff, 0xe1, (sps.length >> 8) & 0xff, sps.length & 0xff,
              ...sps, 0x01, (pps.length >> 8) & 0xff, pps.length & 0xff, ...pps
            ]);

            codecConfig = {
              codec: videoTrackInfo.codec,
              codedWidth: videoTrackInfo.video.width,
              codedHeight: videoTrackInfo.video.height,
              description: avccBox
            };
          } else {
            codecConfig = {
              codec: videoTrackInfo.codec,
              codedWidth: videoTrackInfo.video.width,
              codedHeight: videoTrackInfo.video.height,
            };
          }

          addDebug(`Codec config: ${JSON.stringify(codecConfig)}`);
          const videoDecoder = new VideoDecoder({
            output: handleFrame,
            error: (e) => {
              addDebug(`Decoder error: ${e.message}`);
              setError(`Decoder error: ${e.message}`);
            },
          });

          videoDecoder.configure(codecConfig);
          decoderRef.current = videoDecoder;

          addDebug('Decoder initialized');
          
          mp4boxFile.setExtractionOptions(videoTrackInfo.id);
          mp4boxFile.start();
        };

        mp4boxFile.onReady = async (info) => {
          setVideoInfo(info);
          addDebug('MP4Box ready');
          addDebug(`MP4Box info: ${JSON.stringify(info)}`);
          await initializeDecoder(info);
        };

        mp4boxFile.onError = (e) => {
          addDebug(`MP4Box error: ${e}`);
          throw new Error(`MP4Box error: ${e}`);
        };

        mp4boxFile.onSamples = (track_id, ref, samples) => {
          samples.forEach((sample, index) => {
            if (sample.is_sync) {
              keyFramesRef.current.push(samplesRef.current.length + index);
            }
          });
          samplesRef.current = samplesRef.current.concat(samples);
        };

        const response = await fetch(url);
        const reader = response.body.getReader();

        const processChunk = async ({ done, value }) => {
          if (done) {
            mp4boxFile.flush();
            return;
          }

          const chunk = new Uint8Array(value);
          const arrayBuffer = chunk.buffer;
          arrayBuffer.fileStart = filePosition;

          mp4boxFile.appendBuffer(arrayBuffer);

          filePosition += chunk.length;
          await reader.read().then(processChunk);
        };

        await reader.read().then(processChunk);

      } catch (err) {
        addDebug(`Error: ${err.message}`);
        setError(`Error: ${err.message}`);
      }
    };

    initializeVideo();

    return () => {
      if (decoderRef.current) {
        decoderRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    const decodeFrame = async () => {
      if (!samplesRef.current[frame] || !decoderRef.current) return;

      // Find the nearest previous key frame
      const nearestKeyFrame = keyFramesRef.current.reduce((prev, curr) => 
        (curr <= frame && curr > prev) ? curr : prev
      , -1);

      // Decode from the nearest key frame to the current frame
      for (let i = nearestKeyFrame; i <= frame; i++) {
        const sample = samplesRef.current[i];
        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: sample.cts,
          duration: sample.duration,
          data: sample.data
        });

        await decoderRef.current.decode(chunk);
      }
    };

    decodeFrame();
  }, [frame]);

  const handleFrame = (decodedFrame) => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(decodedFrame, 0, 0, canvas.width, canvas.height);
      decodedFrame.close();
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Video Frame Display</h2>
      {error ? (
        <p className="text-red-500">{error}</p>
      ) : (
        <canvas ref={canvasRef} width="640" height="480" className="border border-gray-300" />
      )}
      {videoInfo && (
        <p className="mt-2">
          Video info: {videoInfo.tracks[0].video.width}x{videoInfo.tracks[0].video.height}, 
          Codec: {videoInfo.tracks[0].codec}
        </p>
      )}
      <pre className="mt-4 p-2 bg-gray-100 rounded overflow-auto max-h-40">{debug}</pre>
    </div>
  );
};

function ControlBar({ frame, onForwardClick, onBackWardClick }) {
  return (
    <div className="control">
      <button className="backward" onClick={onBackWardClick}>Previous frame</button>
      <label>Current frame: {frame}</label>
      <button className="forward" onClick={onForwardClick}>Next frame</button>
    </div>
  );
}