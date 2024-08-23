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

  function handleVideoForward() {
    setFrame(frame => frame + 1);
  }
  function handleVideoBackward() {
    setFrame(frame => {
      if (frame > 0) {
        return frame - 1
      }
      return frame
    });
  }

  return (
    <>
      <div className="display">
        <VideoFrameDisplay
          frame={ frame }
          canvasRef={ canvasRef }
          decoderRef = { decoderRef }
          videoInfo = { videoInfo }
          setVideoInfo={ setVideoInfo }
          error={ error }
          setError={ setError }
          debug={ debug }
          setDebug={ setDebug }/>
      </div>
      <div className="control">
        <ControlBar frame={ frame } setFrame={ setFrame } onForwardClick={ () => handleVideoForward() } onBackWardClick={ () => handleVideoBackward() }/>
      </div>
      
    </>
  );
}

const VideoFrameDisplay = ({ frame, canvasRef, decoderRef, videoInfo, setVideoInfo, error, setError, debug, setDebug }) => {

  const handleFrame = (frame) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    frame.close();
  };

  const addDebug = (message) => {
    setDebug(prev => prev + '\n' + message);
  };

  useEffect(() => {
    const mp4boxFile = createFile();
    let filePosition = 0;
    let pendingSamples = [];

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
      try {
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

        addDebug(`AVC configuration found: ${avcC ? 'Yes' : 'No'}`);
        addDebug(`AVC configuration structure: ${JSON.stringify(avcC)}`);

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

        await videoDecoder.configure(codecConfig);
        decoderRef.current = videoDecoder;

        addDebug('Decoder initialized');

        // Process any pending samples
        for (const sample of pendingSamples) {
          await decodeFrame(sample);
        }
        pendingSamples = [];

        mp4boxFile.setExtractionOptions(videoTrackInfo.id, null, { nbSamples: 1 });
        mp4boxFile.start();
      } catch (err) {
        addDebug(`Error in initializeDecoder: ${err.message}`);
        setError(`Error in initializeDecoder: ${err.message}`);
      }
    };

    const fetchAndProcessVideo = async () => {
      try {
        const response = await fetch(url);
        const reader = response.body.getReader();

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
          if (samples.length > 0) {
            if (decoderRef.current) {
              decodeFrame(samples[0]).catch(e => {
                addDebug(`Decoding error: ${e.message}`);
                setError(`Decoding error: ${e.message}`);
              });
            } else {
              pendingSamples.push(samples[0]);
            }
          }
        };

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
          await reader.read().then(processChunk).catch(e => {
            addDebug(`Error reading video chunk: ${e.message}`);
            throw new Error(`Error reading video chunk: ${e.message}`);
          });
        };

        await reader.read().then(processChunk).catch(e => {
          addDebug(`Error processing video: ${e.message}`);
          throw new Error(`Error processing video: ${e.message}`);
        });

      } catch (err) {
        addDebug(`Error: ${err.message}`);
        setError(`Error: ${err.message}`);
      }
    };

    const decodeFrame = async (sample) => {
      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: sample.cts,
        duration: sample.duration,
        data: sample.data
      });

      await decoderRef.current.decode(chunk);
    };

    const handleFrame = (frame) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        frame.close();
      }
    };

    fetchAndProcessVideo().catch(e => {
      addDebug(`Error initializing video: ${e.message}`);
      setError(`Error initializing video: ${e.message}`);
    });

    return () => {
      if (decoderRef.current) {
        decoderRef.current.close();
      }
    };
  }, [url, frame]);

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

  // Display the current frame number
  return <>
    <div className="control">
      <button className="forward" onClick={ onForwardClick }>Next frame</button>
      <label>Current frame: { frame }</label>
      <input type="submit"/>
      <button className="backward" onClick={ onBackWardClick }>Previous frame</button>
    </div>
  </> 
}