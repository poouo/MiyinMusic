/** A complete PCM WAVE stream, with real samples and reliable duration metadata. */
export function wav(seconds = 200): Buffer {
  const rate = 1000, depth = 24, bytes = Math.round(seconds * rate) * 3
  const data = Buffer.alloc(44 + bytes)
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 3, 28)
  data.writeUInt16LE(3, 32); data.writeUInt16LE(depth, 34)
  data.write('data', 36); data.writeUInt32LE(bytes, 40)
  return data
}
