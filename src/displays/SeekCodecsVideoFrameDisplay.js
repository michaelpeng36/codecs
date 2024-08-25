// import { createFile } from 'mp4box';
// import { useEffect } from 'react';

// const SeekCodecsVideoFrameDisplay = ({
//     url,
//     frameIndex,
//     canvasRef,
//     decoderRef,
//     displayCounter,
//     isInitialized,
//     videoInfo,
//     setVideoInfo,
//     error,
//     setError,
//     setDebug,
//     setIsInitialized,
//     mp4boxFileRef,
//     samplesRef }) => {

//     const frameRef = useRef(null);
//     const closedFrameRef = useRef(true);
  
//     const addDebug = (message) => {
//       setDebug(prev => prev + '\n' + message);
//     };
    
//     useEffect(() => {
//       const initializeVideo = async () => {
//         try {
//           const mp4boxFile = createFile();
//           mp4boxFileRef.current = mp4boxFile;
//           let filePosition = 0;
  
//           const findAvcC = (trak) => {
//             if (trak.mdia?.minf?.stbl?.stsd) {
//               const stsd = trak.mdia.minf.stbl.stsd;
//               for (let i = 0; i < stsd.entries.length; i++) {
//                 const entry = stsd.entries[i];
//                 if (entry.avcC) {
//                   return entry.avcC;
//                 }
//               }
//             }
//             return null;
//           };
  
//           const initializeDecoder = async (info) => {
//             const videoTrackInfo = info.tracks.find(track => track.type === 'video');
//             if (!videoTrackInfo) {
//               throw new Error('No video track found in the file.');
//             }
  
//             addDebug(`Video codec: ${videoTrackInfo.codec}`);
  
//             let avcC = null;
//             if (videoTrackInfo.codec.startsWith('avc1')) {
//               for (let i = 0; i < mp4boxFile.moov.traks.length; i++) {
//                 avcC = findAvcC(mp4boxFile.moov.traks[i]);
//                 if (avcC) break;
//               }
//               if (!avcC) {
//                 addDebug('AVC configuration not found in expected location');
//                 throw new Error('AVC configuration not found');
//               }
//             }
  
//             let codecConfig;
//             if (videoTrackInfo.codec.startsWith('avc1')) {
//               if (!avcC.SPS || !avcC.SPS[0] || !avcC.PPS || !avcC.PPS[0]) {
//                 throw new Error('Invalid AVC configuration structure');
//               }
//               const sps = new Uint8Array(Object.values(avcC.SPS[0].nalu));
//               const pps = new Uint8Array(Object.values(avcC.PPS[0].nalu));
//               const avccBox = new Uint8Array([
//                 0x01, avcC.AVCProfileIndication, avcC.profile_compatibility, avcC.AVCLevelIndication,
//                 0xff, 0xe1, (sps.length >> 8) & 0xff, sps.length & 0xff,
//                 ...sps, 0x01, (pps.length >> 8) & 0xff, pps.length & 0xff, ...pps
//               ]);
  
//               codecConfig = {
//                 codec: videoTrackInfo.codec,
//                 codedWidth: videoTrackInfo.video.width,
//                 codedHeight: videoTrackInfo.video.height,
//                 description: avccBox
//               };
//             } else {
//               codecConfig = {
//                 codec: videoTrackInfo.codec,
//                 codedWidth: videoTrackInfo.video.width,
//                 codedHeight: videoTrackInfo.video.height,
//               };
//             }
  
//             addDebug(`Codec config: ${JSON.stringify(codecConfig)}`);
//             const videoDecoder = new VideoDecoder({
//               output: handleFrame,
//               error: (e) => {
//                 addDebug(`Decoder error: ${e.message}`);
//                 setError(`Decoder error: ${e.message}`);
//               },
//             });
  
//             videoDecoder.configure(codecConfig);
//             decoderRef.current = videoDecoder;
  
//             addDebug('Decoder initialized');
            
//             // Process one sample at a time
//             mp4boxFile.setExtractionOptions(videoTrackInfo.id, null, { nbSamples: 1 });
//             mp4boxFile.start();
//           };
  
//           mp4boxFile.onReady = async (info) => {
//             setVideoInfo(info);
//             addDebug('MP4Box ready');
//             addDebug(`MP4Box info: ${JSON.stringify(info)}`);
//             await initializeDecoder(info);
//           };
  
//           mp4boxFile.onError = (e) => {
//             addDebug(`MP4Box error: ${e}`);
//             throw new Error(`MP4Box error: ${e}`);
//           };
  
//           // Samples are not necesarily decoded in presentation order, depending on the compression
//           // format. Sorting them according to CTS (presentation timestamp) is needed before decoding/display
//           mp4boxFile.onSamples = (track_id, ref, samples) => {
//             samples.forEach((sample, index) => {
//               if (sample.is_sync) {
//                 keyFramesRef.current.push(samplesRef.current.length + index);
//               }
//             });
//             samplesRef.current = samplesRef.current.concat(samples);
//           };
  
//           const response = await fetch(url);
//           const reader = response.body.getReader();
  
//           const processChunk = async ({ done, value }) => {
//             if (done) {
//               mp4boxFile.flush();
//               return;
//             }
  
//             const chunk = new Uint8Array(value);
//             const arrayBuffer = chunk.buffer;
//             arrayBuffer.fileStart = filePosition;
  
//             mp4boxFile.appendBuffer(arrayBuffer);
//             // addDebug("Adding chunk to mp4box");
  
//             filePosition += chunk.length;
//             await reader.read().then(processChunk);
//           };
  
//           await reader.read().then(processChunk);
  
//         } catch (err) {
//           addDebug(`Error: ${err.message}`);
//           setError(`Error: ${err.message}`);
//         }
//       };
  
//       initializeVideo().then(() => setIsInitialized(true));
  
//       return () => {
//         if (decoderRef.current) {
//           decoderRef.current.close();
//         }
//       };
//     });
  
//     useEffect(() => {
//       const decodeFrame = async () => {
//         if (!isInitialized || !samplesRef.current[frameIndex] || !decoderRef.current) return;
  
//         // Find the nearest previous key frame
//         const lowerKeyFrameIndex = keyFramesRef.current.reduce((prev, curr) => 
//           (curr <= frameIndex && curr > prev) ? curr : prev
//         , -1);
  
//         const upperKeyFrameIndex = keyFramesRef.current.reduce((prev, curr) =>
//           (curr >= frameIndex && curr < prev) ? curr : prev
//         , Number.MAX_SAFE_INTEGER);
  
//         addDebug(keyFramesRef.current);
//         addDebug(`Lower key frame index: ${lowerKeyFrameIndex}`);
//         addDebug(`Upper key frame index: ${upperKeyFrameIndex}`);
//         addDebug(`Samples: ${JSON.stringify(samplesRef.current.map(s => s.cts) )}`)
  
//         // Reset frames reference
//         framesRef.current.forEach((frame, index) => {
//           frame.close();
//         });
//         framesRef.current = [];
  
//         // Decode from the nearest key frame to the current frame
//         for (let i = lowerKeyFrameIndex; i <= upperKeyFrameIndex; i++) {
//           const sample = samplesRef.current[i];
//           const chunk = new EncodedVideoChunk({
//             type: sample.is_sync ? 'key' : 'delta',
//             timestamp: sample.cts,
//             duration: sample.duration,
//             data: sample.data
//           });
//           addDebug(`Frame index: ${i}, timestamp: ${sample.cts}`);
//           await decoderRef.current.decode(chunk);
//         }
//         await decoderRef.current.flush();
      
//         displayFrameRef(lowerKeyFrameIndex, upperKeyFrameIndex);
//       };
  
//       decodeFrame();
//     }, [frameIndex, isInitialized]);
  
//     const handleFrame = (decodedFrame) => {
//       if (!frameClosedRef.current) {
//         frame
//       }
//     };
  
//     const displayFrameRef = (lowerKeyFrameIndex, upperKeyFrameIndex) => {
//       const canvas = canvasRef.current;
//       displayCounter.current += 1;
//       // addDebug(`lowerIndex: ${lowerKeyFrameIndex}, upperIndex: ${upperKeyFrameIndex}`);
//       addDebug(`Number of times displayed ${displayCounter.current}`);
//       // Sort inter key-frame buffers by the display time (CTS)
//       framesRef.current.sort((f1, f2) => {
//         if (f1.timestamp > f2.timestamp) {
//           return 1;
//         }
//         return -1;
//       })
//       const frameToDisplay = framesRef.current[frameIndex - lowerKeyFrameIndex];
//       if (canvas) {
//         const ctx = canvas.getContext('2d');
//         ctx.drawImage(frameToDisplay, 0, 0, canvas.width, canvas.height);
//       }
//     }
  
//     return (
//       <div className="w-full max-w-xl mx-auto p-4">
//         <h2 className="text-xl font-bold mb-4">Codecs Video Frame Display</h2>
//         {error ? (
//           <p className="text-red-500">{error}</p>
//         ) : (videoInfo ? (
//           <canvas ref={canvasRef} height={videoInfo.tracks[0].video.height} width={videoInfo.tracks[0].video.width} className="border border-gray-300" />
//           // Should never reach the below line
//         ) : null)}
//         {videoInfo && (
//           <p className="mt-2">
//             Video info: {videoInfo.tracks[0].video.width}x{videoInfo.tracks[0].video.height}, 
//             Codec: {videoInfo.tracks[0].codec}
//           </p>
//         )}
//       </div>
//     );
// };
  
// export default CodecsVideoFrameDisplay;