import { useEffect, useRef, useState } from 'react';

const HTMLVideoFrameDisplay = ({
    url,
    frameIndex,
    isInitialized,
    setDebug }) => {
    const [htmlError, setHtmlError] = useState('');
    const videoRef = useRef(null);

    useEffect(() => {
      if (!isInitialized) return;
      try {
        if (videoRef.current) {
          setDebug(`Attempting to set the current time of videoRef to ${frameIndex / 60}`);
          videoRef.current.currentTime = frameIndex / 60; // Assuming 60 fps
        }
      }
      catch (e) {
        setHtmlError(`HTML video error: ${e.message}`);
      }
    }, [frameIndex]);

    return <>
    <div className="flex flex-col items-center">
      <h2>HTML Video Frame Display</h2>
      <video
        ref={videoRef}
        src={url}
        className="w-full max-w-lg"
        onLoadedMetadata={() => videoRef.current.pause()}
        type="video/mp4"
      />
    </div>
    </>
};

export default HTMLVideoFrameDisplay;