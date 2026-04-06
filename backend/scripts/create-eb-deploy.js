const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const defaultOutput = path.join(repoRoot, "backend-deploy.zip");
const outputArg = process.argv[2] ? path.resolve(process.argv[2]) : defaultOutput;
const relativeOutput = path.relative(repoRoot, outputArg);

if (!relativeOutput || relativeOutput.startsWith("..")) {
  console.error("Output path must stay inside the repository.");
  process.exit(1);
}

if (fs.existsSync(outputArg)) {
  fs.unlinkSync(outputArg);
}

const archive = spawnSync(
  "git",
  ["archive", "--format=zip", `--output=${relativeOutput}`, "HEAD:backend"],
  {
    cwd: repoRoot,
    stdio: "inherit"
  }
);

if (archive.status !== 0) {
  process.exit(archive.status || 1);
}

console.log(`Created ${relativeOutput}`);
console.log("This ZIP uses the tracked backend files from Git HEAD, so node_modules and .env are excluded.");
console.log("Commit your backend changes before packaging if you want the latest edits included.");
