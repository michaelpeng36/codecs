import { useState, useEffect, useRef } from 'react';
import { createFile } from 'mp4box';
import src from './assets/channel-1-display-0.mp4';
import FrameExtractor from './lib/FrameExtractor';

export default function VideoPlayer() {
  const [timestamp, setTimestamp] = useState(null);
  const [debug, setDebug] = useState('');

  function handleVideoForward() {
    const FPS = 60;
    if (timestamp === null) {
      setTimestamp(1/FPS);
    } else {
      setTimestamp(timestamp + 1/FPS);
    }
  }

  function handleVideoJump() {
    const FPS = 60;
    setTimestamp(timestamp + 20/FPS);
  }

  return (
    <>
      <div className="display">
        <VideoFrameDisplay timestamp={timestamp} setDebug={setDebug} />
      </div>
      <div className="control">
        <ControlBar timestamp={timestamp} onForwardClick={handleVideoForward} onJumpClick={handleVideoJump} debug={debug} />
      </div>
    </>
  );
}

const VideoFrameDisplay = ({ timestamp, setDebug }) => {
  const canvasRef = useRef(null);
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const frameExtractorRef = useRef(null);

  const addDebug = (message) => {
    setDebug(prev => prev + '\n' + message);
  };

  const displayVideoFrame = (decodedFrame) => {
    const canvas = canvasRef.current;
    if (canvas) {
      addDebug(`Seeked timestamp: ${timestamp}, frame timestamp: ${decodedFrame.timestamp}`)
      const ctx = canvas.getContext('2d');
      ctx.drawImage(decodedFrame, 0, 0, canvas.width, canvas.height)
    }
  };

  useEffect(() => {
    const setup = async () => {
      addDebug("Setting up frame extractor...");
      const frameExtractor = new FrameExtractor(src, displayVideoFrame);
      frameExtractorRef.current = frameExtractor;
      await frameExtractor.initialize().catch(e => {
        addDebug(e.message);
        setError(e.message);
      });
      setInitialized(true);
      addDebug("Successfully set up the frame extractor!");
    }
    setup();
    return () => { frameExtractorRef.current.close() }
  }, []);

  useEffect(() => {
    if (!initialized || !frameExtractorRef.current) {
      return;
    }
    frameExtractorRef.current.seek(timestamp);
  }, [initialized, timestamp]);

  return (
    <div className="w-full max-w-xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Video Frame Display</h2>
      {/* <h3>Time to perform: { endRef.current - startRef.current }</h3> */}
      {error ? (
        <p className="text-red-500">{error}</p>
      ) : 
        <canvas ref={canvasRef} width="1920" height="1080" className="border border-gray-300" />
        // Should never reach the below line
      }
      {/* {videoInfo && (
        <p className="mt-2">
          Video info: {videoInfo.tracks[0].video.width}x{videoInfo.tracks[0].video.height}, 
          Codec: {videoInfo.tracks[0].codec}
        </p>
      )} */}
    </div>
  );
};

function ControlBar({ timestamp, onForwardClick, onJumpClick, debug }) {
  return (
    <div className="control">
      <label>Current timestamp: {timestamp}</label>
      <button className="forward" onClick={onForwardClick}>Next frame</button>
      <button className="jump" onClick={onJumpClick}>Jump!</button>
      <pre className="mt-4 p-2 bg-gray-100 rounded overflow-auto max-h-40">{debug}</pre>
    </div>
  );
}