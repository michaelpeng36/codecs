import { useState, useEffect, useRef } from 'react';
import { createFile } from 'mp4box';
import src from './assets/channel-1-display-0.mp4';
import VideoFrameExtractor from './lib/models/extractor';

export default function VideoPlayer() {
  const [timestamp, setTimestamp] = useState(null);
  const [debug, setDebug] = useState('');

  function handleVideoForward() {
    const FPS = 60;
    if (timestamp === null) {
      setTimestamp(1/FPS);
    } else {
      setTimestamp(timestamp + 100/FPS);
    }
  }

  function handleVideoJump() {
    const FPS = 60;
    setTimestamp(timestamp + 2000/FPS);
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
  const videoInfoRef = useRef(null);
  const videoFrameStreamRef = useRef(null);

  const addDebug = (message) => {
    setDebug(prev => prev + '\n' + message);
  };

  const displayVideoFrame = (decodedFrame) => {
    const canvas = canvasRef.current;
    if (canvas && decodedFrame) {
      // throw new Error(`Video frame: ${JSON.stringify(decodedFrame)}`)
      addDebug(`Seeked timestamp: ${timestamp}, frame timestamp: ${decodedFrame.timestamp}`)
      const ctx = canvas.getContext('2d');
      ctx.drawImage(decodedFrame, 0, 0, canvas.width, canvas.height)
    }
    decodedFrame.close();
  };

  useEffect(() => {
    const setup = async () => {
      addDebug("Setting up video frame stream...");
      const videoFrameStream = new VideoFrameExtractor(src, displayVideoFrame, 5);
      videoFrameStreamRef.current = videoFrameStream;
      videoFrameStream.start()
      videoInfoRef.current = videoFrameStream.info;
      setInitialized(true);
      addDebug("Successfully set up the video frame stream!");
    }
    setup();
    return () => { videoFrameStreamRef.current.close() }
  }, []);

  useEffect(() => {
    if (!initialized || !videoFrameStreamRef.current) {
      return;
    }
    videoFrameStreamRef.current.next();
  }, [initialized, timestamp]);

  return (
    <div className="w-full max-w-xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Video Frame Display</h2>
      {/* <h3>Time to perform: { videoFrameStreamRef.current.end - videoFrameStreamRef.current.start }</h3> */}
      {error ? (
        <p className="text-red-500">{error}</p>
      ) : 
        <canvas ref={canvasRef} width="1920" height="1080" className="border border-gray-300" />
      }
      {videoInfoRef.current && (
        <p className="mt-2">
          Video info: {videoInfoRef.current.video.width}x{videoInfoRef.current.video.height}, 
          Codec: {videoInfoRef.current.codec}
        </p>
      )}
    </div>
  );
};

function ControlBar({ timestamp, onForwardClick, onJumpClick, debug }) {
  return (
    <div className="control">
      <p>Current timestamp: {timestamp}</p>
      <button className="forward" onClick={onForwardClick}>Next frame</button>
      <button className="jump" onClick={onJumpClick}>Jump!</button>
      <pre className="mt-4 p-2 bg-gray-100 rounded overflow-auto max-h-40">{debug}</pre>
    </div>
  );
}