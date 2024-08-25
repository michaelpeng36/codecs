import { useState, useEffect, useRef } from 'react';
import CodecsVideoFrameDisplay from './displays/CodecsVideoFrameDisplay';
import HTMLVideoFrameDisplay from './displays/HTMLVideoFrameDisplay';
import SeekCodecsVideoFrameDisplay from './displays/SeekCodecsVideoFrameDisplay';
import url from './assets/channel-1-display-0.mp4';

export default function VideoPlayer() {
  const displayCounter = useRef(0);
  const framesRef = useRef([]);
  const frameRef = useRef(null);
  const closedFrameRef = useRef(true);
  const canvasRef = useRef(null);
  const decoderRef = useRef(null);
  const mp4boxFileRef = useRef(null);
  const samplesRef = useRef([]);
  const keyFramesRef = useRef([]);

  const [error, setError] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [debug, setDebug] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);

  function handleVideoForward() {
    setFrameIndex(frameIndex => frameIndex + 1);
  }
  function handleVideoBackward() {
    setFrameIndex(frameIndex => Math.max(0, frameIndex - 1));
  }

  return (
    <>
      <div className="display">
        <CodecsVideoFrameDisplay
          url={url}
          frameIndex={frameIndex}
          framesRef={framesRef}
          frameRef={frameRef}
          closedFrameRef={closedFrameRef}
          canvasRef={canvasRef}
          decoderRef={decoderRef}
          displayCounter={displayCounter}
          isInitialized={isInitialized}
          videoInfo={videoInfo}
          setVideoInfo={setVideoInfo}
          error={error}
          setError={setError}
          setIsInitialized={setIsInitialized}
          debug={debug}
          setDebug={setDebug}
          mp4boxFileRef={mp4boxFileRef}
          samplesRef={samplesRef}
          keyFramesRef={keyFramesRef}
        />
        <HTMLVideoFrameDisplay
          url={url}
          frameIndex={frameIndex}
          isInitialized={isInitialized}
          setError={setError}
          setDebug={setDebug}
        />
        {/* <SeekCodecsVideoFrameDisplay
          url={url}
          frameIndex={frameIndex}
          framesRef={framesRef}
          frameRef={frameRef}
          closedFrameRef={closedFrameRef}
          canvasRef={canvasRef}
          decoderRef={decoderRef}
          displayCounter={displayCounter}
          isInitialized={isInitialized}
          videoInfo={videoInfo}
          setVideoInfo={setVideoInfo}
          error={error}
          setError={setError}
          setIsInitialized={setIsInitialized}
          debug={debug}
          setDebug={setDebug}
          mp4boxFileRef={mp4boxFileRef}
          samplesRef={samplesRef}
          keyFramesRef={keyFramesRef}
        /> */}
      </div>
      <div className="control">
        <ControlBar frameIndex={frameIndex} onForwardClick={handleVideoForward} onBackwardClick={handleVideoBackward} debug={debug} />
      </div>
    </>
  );
}

function ControlBar({ frameIndex, onForwardClick, onBackwardClick, debug  }) {
  return (
    <div className="control">
      <button className="backward" onClick={onBackwardClick}>Previous frame</button>
      <label>Current frame: {frameIndex}</label>
      <button className="forward" onClick={onForwardClick}>Next frame</button>
      <pre className="mt-4 p-2 bg-gray-100 rounded overflow-auto max-h-40">{debug}</pre>
    </div>
  );
}