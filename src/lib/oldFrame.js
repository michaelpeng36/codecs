import { useRef, useEffect, useState } from 'react';
import { createFile } from 'mp4box';

const VideoFrameDisplay = ({ src, frameIndex, setDebug }) => {
    const sampleBufferRef = useRef([]);
    const pendingFramesRef = useRef([]);
    const videoTrackIdRef = useRef(0);
    const canvasRef = useRef(null);
    const decoderRef = useRef(null);
    const [error, setError] = useState(null);
    const [videoInfo, setVideoInfo] = useState(null);
    const mp4boxFileRef = useRef(null);
    const [initialized, setInitialized] = useState(false);
    const startRef = useRef(null);
    const endRef = useRef(null);
  
    const addDebug = (message) => {
      setDebug(prev => prev + '\n' + message);
    };
  
    const initializeDecoder = async (info) => {
      const handleVideoFrame = (decodedFrame) => {
        pendingFramesRef.current.push(decodedFrame);
      };
  
      addDebug(JSON.stringify(info));
  
      // mp4box must be initialized before the decoder, as the decoder can only
      // be initialized once the moov atom has been parsed
      const mp4boxFile = mp4boxFileRef.current;
  
      let codecConfig = null;
      // Assumption: there is only one video track per mp4
      // If there are multiple video tracks for different resolutions or angles,
      // this filtering will need to be refined.
      const videoTrackInfo = info.tracks.find(track => track.type === "video")
      addDebug(`Video track ID: ${videoTrackInfo.id}`);
      videoTrackIdRef.current = videoTrackInfo.id;
      // Assumption: the .mp4 file is encoded with H.264
      // See: https://www.w3.org/TR/webcodecs-avc-codec-registration/
      addDebug(`Codec ${videoTrackInfo.codec}`);
      // H.264 codecs require the avcc binary blob be passed to the video decoder
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
  
      let avcC = null;
      if (videoTrackInfo.codec.startsWith('avc1.') || videoTrackInfo.codec.startsWith('avc3.')) {
        for (let i = 0; i < mp4boxFile.moov.traks.length; i++) {
          avcC = findAvcC(mp4boxFile.moov.traks[i]);
          if (avcC) break;
        }
        if (!avcC) {
          addDebug('AVC configuration not found in expected location');
          throw new Error('AVC configuration not found');
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
      
      const { supported } = await VideoDecoder.isConfigSupported(codecConfig);
      addDebug(`Codec config ${JSON.stringify(codecConfig)} is supported: ${supported}`);
  
      const decoder = new VideoDecoder({
        output: handleVideoFrame,
        error: (e) => {
          addDebug(e.message);
          setError(e.message);
        }
      });
  
      decoder.configure(codecConfig);
      decoderRef.current = decoder;
  
      addDebug("Initialized and configured decoder!");
    };
  
    const setupDemuxerAndDecoder = () => {
      if (mp4boxFileRef.current) {
        addDebug("mp4boxFileRef already exists! Skipping demuxer and decoder setup.");
        return;
      }
      mp4boxFileRef.current = createFile();
      const mp4boxFile = mp4boxFileRef.current;
  
      // Set the video info
      mp4boxFile.onReady = (info) => {
        addDebug("Parsed the `moov` box of the track!");
        setVideoInfo(info);
        // We can only initialize the VideoDecoder after setting videoInfo
        initializeDecoder(info)
          .then(() => {
            mp4boxFile.setExtractionOptions(videoTrackIdRef.current, null);
            mp4boxFile.start();
          });
      };
  
      mp4boxFile.onSamples = (trackId, ref, samples) => {
        // Samples array set to the max number of samples that can be held in memory
        sampleBufferRef.current = sampleBufferRef.current.concat(samples);
        addDebug(`Appending new samples to the sampleBuffer. New length: ${sampleBufferRef.current.length}`);
      };
  
      mp4boxFile.onError = (e) => {
        addDebug(e.message);
        throw new Error(`MP4Box error: ${e.message}`);
      }
  
      addDebug("Initialized mp4box!");
    };
  
    const fetchAndSampleVideo = async () => {
      const response = await fetch(src);
      const reader = response.body.getReader();
      let filePosition = 0;
  
      const processChunk = async ({ done, value }) => {
        if (done) {
          mp4boxFileRef.current.flush();
          setInitialized(true)
          return;
        }
        
        const chunk = new Uint8Array(value);
        const arrayBuffer = chunk.buffer;
        arrayBuffer.fileStart = filePosition;
  
        addDebug("Passing chunk from the .mp4 video to mp4box!");
        mp4boxFileRef.current.appendBuffer(arrayBuffer);
        filePosition += chunk.length;
  
        await reader.read().then(processChunk);
      };
      
      await reader.read().then(processChunk);
    };
  
    const displayVideoFrame = async () => {
      const canvas = canvasRef.current;
      if (!canvas || pendingFramesRef.current.length === 0) return;
  
      const pendingFrame = pendingFramesRef.current.shift();
      addDebug(`Frame index: ${frameIndex}, timestamp: ${pendingFrame.timestamp}`)
      const ctx = canvas.getContext('2d');
      ctx.drawImage(pendingFrame, 0, 0, canvas.width, canvas.height)
      pendingFrame.close();
    };
  
    // Setup the video -> demuxer -> decoder pipeline
    useEffect(() => {
      const setup = async () => {
        addDebug("Setting up demuxer and decoder...");
        setupDemuxerAndDecoder();
        await fetchAndSampleVideo();
      }
      setup();
      return () => { console.log("Disposing!" )}
    }, []);
  
    useEffect(() => {
      const decodeAndDisplayFrame = async () => {
        const decoder = decoderRef.current;
        const sampleBuffer = sampleBufferRef.current;
        addDebug(`Fetching sample ${frameIndex} from the sample buffer, which is of length ${sampleBufferRef.current.length}`);
        startRef.current = performance.now();
        const sample = sampleBuffer[frameIndex];
        addDebug(`Sample: ${JSON.stringify(sample)}`)
        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: sample.cts,
          duration: sample.duration,
          data: sample.data
        });
        await decoder.decode(chunk);
        await displayVideoFrame();
      };
      if (!initialized || !decoderRef.current || !sampleBufferRef.current[frameIndex]) {
        return;
      }
      decodeAndDisplayFrame().then(() => {endRef.current = performance.now()});
    }, [initialized, frameIndex]);
  
    return (
      <div className="w-full max-w-xl mx-auto p-4">
        <h2 className="text-xl font-bold mb-4">Video Frame Display</h2>
        <h3>Time to perform: { endRef.current - startRef.current }</h3>
        {error ? (
          <p className="text-red-500">{error}</p>
        ) : (videoInfo ? (
          <canvas ref={canvasRef} width={videoInfo.tracks[0].video.width} height={videoInfo.tracks[0].video.height} className="border border-gray-300" />
          // Should never reach the below line
        ) : null)}
        {videoInfo && (
          <p className="mt-2">
            Video info: {videoInfo.tracks[0].video.width}x{videoInfo.tracks[0].video.height}, 
            Codec: {videoInfo.tracks[0].codec}
          </p>
        )}
      </div>
    );
  };

export default VideoFrameDisplay;