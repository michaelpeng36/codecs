import { createFile } from 'mp4box';

class VideoSink {
  #demuxer;
  #position;

  constructor(file) {
    this.#demuxer = file;
    this.#position = 0;
  }

  write(value) {
    const chunk = new Uint8Array(value);
    const arrayBuffer = chunk.buffer;
    arrayBuffer.fileStart = this.#position;
    this.#position += chunk.length;
    this.#demuxer.appendBuffer(arrayBuffer);
  }

  close() {
    this.#demuxer.flush();
  }
}

class VideoFrameExtractor {
  #src;
  videoInfo;
  #handleVideoFrame;
  #pendingFrames;
  #maxPendingChunks;
  #timestampWatermark
  #demuxer;
  #decoder;
  #ready;
  st;
  et;

  constructor(src, handleVideoFrame, maxPendingChunks) {
      this.#src = src;
      this.#maxPendingChunks = maxPendingChunks;
      this.#pendingFrames = [];
      this.#handleVideoFrame = handleVideoFrame;
      this.#timestampWatermark = 0;
      this.#ready = this.start();
      this.st = 0;
      this.et = 0;
  }

  seek(timestamp) {
    // throw new Error(`videoInfo: ${JSON.stringify(this.videoInfo)}`)
    // const mappedTimestamp = timestamp * this.videoInfo.timescale;
    if (timestamp === null || timestamp < 0 || timestamp > this.videoInfo.duration) return;
    this.st = performance.now();
    // Fast forward pending frames until we reach one where the frame is close to what we want
    while (timestamp > this.#timestampWatermark) {
      this.#pendingFrames.forEach()
      // Close all pending frames and reset the pending frames array
      const frame = this.#pendingFrames.shift();
      frame.close();
    }

    let curr = null;
    // Find the frame with the greatest timestamp greater than or equal to the given timestamp
    while (this.#pendingFrames.length > 0) {
      // Close the previous frame if it exists
      if (curr) {
        curr.close();
      }
      
      curr = this.#pendingFrames[0];

      if (curr.timestamp > timestamp) {
        this.frameHandler(curr);
        return;
      } else {
        const skippedFrame = this.#pendingFrames.shift();
        skippedFrame.close();
      }
    }
    return;
  }

  async start() {
    this.#initializeDemuxer();

    return fetch(this.#src).then(response => {
      const sink = new VideoSink(this.#demuxer);
      const chunkStream = new WritableStream(sink, { highWaterMark: this.#maxPendingChunks });
      return response.body.pipeTo(chunkStream, { highWaterMark: this.#maxPendingChunks });
    })
  };

  #initializeDemuxer() {
    if (this.#demuxer) {
      return;
    }
    this.#demuxer = createFile();

    // Set the video info and initialize the decoder once the moov box has been parsed
    this.#demuxer.onReady = async (info) => {
      // Assumption: there is only one video track per mp4
      // If there are multiple video tracks for different resolutions or angles,
      // this filtering will need to be refined.
      this.videoInfo = info.tracks.find(track => track.type === "video");
      // Decoder can only be initialized once the moov atom has been parsed
      await this.#initializeDecoder();
      this.#demuxer.setExtractionOptions(this.videoInfo.id, null);
      this.#demuxer.start();
    };

    this.#demuxer.onSamples = (trackId, ref, samples) => {
      for (const sample of samples) {
        console.log(`Sample: type=${sample.is_sync ? 'key' : 'delta'}, size=${sample.data.byteLength}`);
        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: sample.cts,
          duration: sample.duration,
          data: sample.data
        });
        this.#decoder.decode(chunk);
      }
    };

    this.#demuxer.onError = (e) => {
      throw new Error(`Demuxer error: ${e.message}`);
    }
  };

  async #initializeDecoder() {
    // Assumption: the .mp4 file is encoded with H.264, which require the avcc binary
    // blob be passed to the video decoder.
    // See: https://www.w3.org/TR/webcodecs-avc-codec-registration/
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
    
    let codecConfig = null;
    let avcC = null;
    if (this.videoInfo.codec.startsWith('avc1.') || this.videoInfo.codec.startsWith('avc3.')) {
      for (let i = 0; i < this.#demuxer.moov.traks.length; i++) {
        avcC = findAvcC(this.#demuxer.moov.traks[i]);
        if (avcC) break;
      }
      if (!avcC) {
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
        codec: this.videoInfo.codec,
        codedWidth: this.videoInfo.video.width,
        codedHeight: this.videoInfo.video.height,
        description: avccBox
      };
    } else {
      codecConfig = {
        codec: this.videoInfo.codec,
        codedWidth: this.videoInfo.video.width,
        codedHeight: this.videoInfo.video.height,
      };
    }
    
    const { supported } = await VideoDecoder.isConfigSupported(codecConfig);
    if (!supported) {
      console.error(`Unsupported codec configuration:`, codecConfig);
      throw new Error(`Configuration ${JSON.stringify(codecConfig)} for codec ${this.videoInfo.codec} is not supported`);
    }

    const handleVideoFrame = (decodedFrame) => {
      this.#handleVideoFrame(decodedFrame);
      this.et = performance.now();
    }
    
    const decoder = new VideoDecoder({
      output: handleVideoFrame,
      error: (e) => { 
        console.error(`Decoder error: ${e.message}`);
        throw new Error(`Decoder error: ${e.message}`)
      }
    });

    decoder.configure(codecConfig);
    this.#decoder = decoder;
  };

  next() {
    const frame = this.#pendingFrames.shift();
    if (frame) {
      this.#handleVideoFrame(frame);
      frame.close();
    }
  }

  close() {
    if (this.#decoder) {
      this.#decoder.close();
    }
  }

}

export default VideoFrameExtractor;