import { createFile } from 'mp4box';

class FrameExtractor {
  #src;
  frameHandler;
  info;
  #pendingFrames = [];
  #timestampWaterMark = 0;
  #demuxer;
  #decoder;

  constructor(src, frameHandler) {
      this.#src = src;
      this.frameHandler = frameHandler;
  }

  next() {
    if (!this.#demuxer || !this.#decoder || this.#pendingFrames.length === 0) return;
    const frame = this.#pendingFrames.shift();
    this.frameHandler(frame);
    frame.close();
  };

  seek(timestamp) {
    if (timestamp === null) return;
    // Fast forward pending frames until we reach one where the frame is close to what we want
    while (timestamp > this.#timestampWaterMark) {
      if (this.#pendingFrames.length === 0) {
        continue;
      }
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

  async initialize() {
    // Set up the demuxer and decoder
    this.#initializeDemuxer();

    const response = await fetch(this.#src);
    const reader = response.body.getReader();
    let filePosition = 0;

    const processChunk = async ({ done, value }) => {
      if (done) {
        this.#demuxer.flush();
        return;
      }
      
      const chunk = new Uint8Array(value);
      const arrayBuffer = chunk.buffer;
      arrayBuffer.fileStart = filePosition;

      this.#demuxer.appendBuffer(arrayBuffer);
      filePosition += chunk.length;

      await reader.read().then(processChunk);
    };
    
    await reader.read().then(processChunk);
  };

  #initializeDemuxer() {
    if (this.#demuxer) {
      return;
    }
    this.#demuxer = createFile();

    // Set the video info
    this.#demuxer.onReady = async (info) => {
      this.info = info.tracks.find(track => track.type === "video");
      // demuxer must be initialized before the decoder, as the decoder can only
      // be initialized once the moov atom has been parsed
      await this.#initializeDecoder(info);
      this.#demuxer.setExtractionOptions(this.info.id, null);
      this.#demuxer.start();
    };

    this.#demuxer.onSamples = (trackId, ref, samples) => {
      // Samples array set to the max number of samples that can be held in memory
      samples.forEach(async sample => {
        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: sample.cts,
          duration: sample.duration,
          data: sample.data
        });
        await this.#decoder.decode(chunk);
      });
    };

    this.#demuxer.onError = (e) => {
      throw new Error(`Demuxer error: ${e.message}`);
    }
  };

  async #initializeDecoder(info) {
    const handleVideoFrame = (decodedFrame) => {
      if (decodedFrame.timestamp > this.#timestampWaterMark) {
        this.#timestampWaterMark = decodedFrame.timestamp;
      }
      this.#pendingFrames.push(decodedFrame);
    };

    let codecConfig = null;
    // Assumption: there is only one video track per mp4
    // If there are multiple video tracks for different resolutions or angles,
    // this filtering will need to be refined.
    const videoTrackInfo = info.tracks.find(track => track.type === "video");

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

    let avcC = null;
    if (videoTrackInfo.codec.startsWith('avc1.') || videoTrackInfo.codec.startsWith('avc3.')) {
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
    if (!supported) {
      throw new Error(`Codec configuration for ${videoTrackInfo.codec}`);
    }

    this.#decoder = new VideoDecoder({
      output: handleVideoFrame,
      error: (e) => { throw new Error(`Decoder error: ${e.message}`) }
    });

    this.#decoder.configure(codecConfig);
  };

  close() {
    if (this.#decoder) {
      this.#decoder.close();
    }
  }

}

export default FrameExtractor;