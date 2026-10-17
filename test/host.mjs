// Host-half unit tests: WAV validation and vector math (no native runtime).
import assert from "node:assert/strict"
import { __test } from "../lib/index.js"

const { decodeWav, cosine, clampThreshold } = __test

function wav(samples, sampleRate = 16000) {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write("RIFF", 0, "ascii")
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write("WAVE", 8, "ascii")
  buffer.write("fmt ", 12, "ascii")
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36, "ascii")
  buffer.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(value < 0 ? Math.trunc(value * 0x8000) : Math.trunc(value * 0x7fff), 44 + index * 2)
  }
  return buffer
}

{
  const samples = new Float32Array(16000 * 1.5)
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / 8) * 0.3
  const buffer = wav(samples)
  const decoded = decodeWav(buffer.toString("base64"))
  assert.equal(decoded.samples.length, samples.length)
  assert.ok(Math.abs(decoded.seconds - 1.5) < 0.01)
  assert.ok(Math.abs(decoded.samples[10] - samples[10]) < 0.001)
}

{
  assert.throws(() => decodeWav(""), /required/)
  const buffer = wav(new Float32Array(16000 * 0.2))
  assert.throws(() => decodeWav(buffer.toString("base64")), /too short/)
}

{
  assert.equal(cosine([1, 0], [1, 0]), 1)
  assert.equal(cosine([1, 0], [0, 1]), 0)
  assert.equal(cosine([1, 0], [-1, 0]), -1)
}

{
  assert.equal(clampThreshold(0.1), 0.3)
  assert.equal(clampThreshold(0.62), 0.62)
  assert.equal(clampThreshold("x"), 0.62)
}

console.log("host smoke ok")
