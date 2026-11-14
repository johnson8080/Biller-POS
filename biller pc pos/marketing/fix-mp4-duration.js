/*
 * Fix the duration in a fragmented MP4 that Chrome's MediaRecorder wrote.
 *
 * Chrome's MP4 recorder leaves the movie and track headers with a zero
 * duration, so players think the film is only a few seconds long. This walks
 * the fragments, works out how long each track really is, and writes those
 * numbers back into the headers.
 *
 *   node fix-mp4-duration.js Biller-POS-ad.mp4
 */
const fs = require('fs');
const file = process.argv[2];
if (!file) {
  console.error('usage: node fix-mp4-duration.js <file.mp4>');
  process.exit(1);
}
const buf = fs.readFileSync(file);
console.log('file:', file, (buf.length / 1048576).toFixed(2), 'MB');

function boxes(start, end, visit) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(offset + 8)); header = 16; }
    else if (size === 0) size = end - offset;
    if (size < header) break;
    visit({ type, start: offset, size, header, payloadStart: offset + header, payloadEnd: offset + size });
    offset += size;
  }
}

// 1. The movie header and the two tracks.
const movie = { timescale: 1000, mvhdAt: 0, version: 0 };
const tracks = [];
boxes(0, buf.length, (box) => {
  if (box.type !== 'moov') return;
  boxes(box.payloadStart, box.payloadEnd, (child) => {
    if (child.type === 'mvhd') {
      const version = buf[child.payloadStart];
      const base = child.payloadStart + 4 + (version === 1 ? 16 : 8);
      movie.timescale = buf.readUInt32BE(base);
      movie.mvhdAt = base + 4;
      movie.version = version;
    } else if (child.type === 'trak') {
      const track = { id: 0, timescale: 0, mdhdAt: 0, tkhdAt: 0, mdhdVersion: 0, tkhdVersion: 0 };
      boxes(child.payloadStart, child.payloadEnd, (part) => {
        if (part.type === 'tkhd') {
          const version = buf[part.payloadStart];
          track.tkhdVersion = version;
          // version, flags, creation, modification, track id, reserved, duration
          track.id = buf.readUInt32BE(part.payloadStart + (version === 1 ? 20 : 12));
          track.tkhdAt = part.payloadStart + (version === 1 ? 28 : 20);
        } else if (part.type === 'mdia') {
          boxes(part.payloadStart, part.payloadEnd, (media) => {
            if (media.type === 'mdhd') {
              const version = buf[media.payloadStart];
              const base = media.payloadStart + 4 + (version === 1 ? 16 : 8);
              track.timescale = buf.readUInt32BE(base);
              track.mdhdAt = base + 4;
              track.mdhdVersion = version;
            }
          });
        }
      });
      tracks.push(track);
    }
  });
});
console.log('movie timescale:', movie.timescale, 'tracks:', tracks.map((t) => t.id + '@' + t.timescale).join(' '));

// 2. Walk the fragments and work out where each track ends.
const ends = {};
boxes(0, buf.length, (box) => {
  if (box.type !== 'moof') return;
  let trackId = 0;
  let baseTime = 0;
  let defaultDuration = 0;
  let runSamples = 0;
  let runDuration = 0;
  const readFragment = (start, end) => {
    boxes(start, end, (part) => {
      if (part.type === 'tfhd') {
        const flags = buf.readUInt32BE(part.payloadStart) & 0xffffff;
        trackId = buf.readUInt32BE(part.payloadStart + 4);
        let cursor = part.payloadStart + 8;
        if (flags & 0x000001) cursor += 8;   // base data offset
        if (flags & 0x000002) cursor += 4;   // sample description index
        if (flags & 0x000008) { defaultDuration = buf.readUInt32BE(cursor); cursor += 4; }
        if (flags & 0x000010) cursor += 4;   // default sample size
        if (flags & 0x000020) cursor += 4;   // default sample flags
      } else if (part.type === 'tfdt') {
        const version = buf[part.payloadStart];
        baseTime = version === 1
          ? Number(buf.readBigUInt64BE(part.payloadStart + 4))
          : buf.readUInt32BE(part.payloadStart + 4);
      } else if (part.type === 'trun') {
        const flags = buf.readUInt32BE(part.payloadStart) & 0xffffff;
        const count = buf.readUInt32BE(part.payloadStart + 4);
        let cursor = part.payloadStart + 8;
        if (flags & 0x000001) cursor += 4;    // data offset
        if (flags & 0x000004) cursor += 4;    // first sample flags
        if (flags & 0x000400) cursor += 4;    // sample duration
        if (flags & 0x008000) cursor += 8;    // composition offsets
        let total = 0;
        for (let i = 0; i < count; i += 1) {
          let duration = defaultDuration;
          if (flags & 0x000100) { duration = buf.readUInt32BE(cursor); cursor += 4; }
          if (flags & 0x000200) cursor += 4;
          if (flags & 0x000800) cursor += 4;
          if (flags & 0x001000) cursor += 4;
          total += duration;
        }
        runSamples = count;
        runDuration = total;
      }
    });
  };
  // Each fragment holds one track fragment per track, so they are read
  // separately - otherwise one track's numbers overwrite the other's.
  boxes(box.payloadStart, box.payloadEnd, (part) => {
    if (part.type !== 'traf') return;
    trackId = 0; baseTime = 0; defaultDuration = 0; runSamples = 0; runDuration = 0;
    readFragment(part.payloadStart, part.payloadEnd);
    if (trackId && runSamples) {
      ends[trackId] = Math.max(ends[trackId] || 0, baseTime + runDuration);
    }
  });
});
console.log('track ends (ticks):', ends);

function writeDuration(at, value, version) {
  if (version === 1) buf.writeBigUInt64BE(BigInt(value), at);
  else buf.writeUInt32BE(value, at);
}

let movieSeconds = 0;
for (const track of tracks) {
  const ticks = ends[track.id] || 0;
  const seconds = track.timescale ? ticks / track.timescale : 0;
  movieSeconds = Math.max(movieSeconds, seconds);
  if (track.mdhdAt) writeDuration(track.mdhdAt, Math.round(ticks), track.mdhdVersion);
  if (track.tkhdAt) writeDuration(track.tkhdAt, Math.round(seconds * movie.timescale), track.tkhdVersion);
  console.log('track', track.id, '->', seconds.toFixed(2), 's');
}
if (movie.mvhdAt) writeDuration(movie.mvhdAt, Math.round(movieSeconds * movie.timescale), movie.version);
console.log('movie duration:', movieSeconds.toFixed(2), 's');

fs.writeFileSync(file, buf);
console.log('patched:', file);
