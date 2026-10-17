// Decompress a DSH session log made of concatenated zstd frames and print events.
import { readFileSync } from "node:fs"
import { zstdDecompressSync } from "node:zlib"

const file = process.argv[2]
const limit = Number(process.argv[3] ?? 40)
const filter = process.argv[4] === undefined ? undefined : new RegExp(process.argv[4])
const buf = readFileSync(file)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let i = 0; i + 4 <= buf.length; i += 1) {
  if (buf[i] === magic[0] && buf[i + 1] === magic[1] && buf[i + 2] === magic[2] && buf[i + 3] === magic[3]) starts.push(i)
}
if (starts.length === 0 || starts[0] !== 0) starts.unshift(0)
let text = ""
for (let index = 0; index < starts.length; index += 1) {
  const slice = buf.subarray(starts[index], starts[index + 1] ?? buf.length)
  try {
    text += zstdDecompressSync(slice).toString("utf8")
  } catch (error) {
    console.error("frame", index, "failed:", error.message)
  }
}
const lines = text.split("\n").filter(Boolean)
console.log(`# frames=${starts.length} lines=${lines.length}`)
const selected = filter === undefined
  ? lines
  : lines.filter((line) => {
      try {
        const event = JSON.parse(line)
        return filter.test(event.type ?? event.event?.type ?? "")
      } catch {
        return false
      }
    })
for (const line of selected.slice(-limit)) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    console.log("unparsed", line.slice(0, 200))
    continue
  }
  const type = event.type ?? event.event?.type ?? "?"
  const data = event.data ?? event.event?.data ?? event
  let summary = JSON.stringify(data)
  if (summary.length > 500) summary = summary.slice(0, 500) + "…"
  console.log(type, summary)
}
