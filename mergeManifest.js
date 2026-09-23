const { Reporter } = require("@parcel/plugin")
const fs = require("fs").promises
const path = require("path")

const FAMILY = {
  chrome: "chrome",
  edge: "chrome",
  firefox: "firefox",
}

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"))

module.exports = new Reporter({
  async report({ event }) {
    const target = process.env.SCHEMO_TARGET

    if (event.type !== "buildSuccess" || !target) {
      return
    }

    if (!FAMILY[target]) {
      throw new Error(`unknown SCHEMO_TARGET "${target}"`)
    }

    const { version } = await readJson("./package.json")
    const common = await readJson("./manifest/common.json")
    const specific = await readJson(`./manifest/${FAMILY[target]}.json`)
    const dist = path.join("dist", target)

    await fs.mkdir(dist, { recursive: true })
    await fs.writeFile(
      path.join(dist, "manifest.json"),
      JSON.stringify({ ...common, ...specific, version }, null, 2) + "\n"
    )
  },
})
