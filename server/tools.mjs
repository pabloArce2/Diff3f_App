// Finds the Python of the Diff3F conda environment and a Blender install.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isWindows = process.platform === "win32";

// DIFF3F_PYTHON, else the active conda env if it is the right one, else the usual install folders.
export function findPython(envName = process.env.DIFF3F_ENV || "diff3f") {
  if (process.env.DIFF3F_PYTHON) return process.env.DIFF3F_PYTHON;

  const prefixes = [];
  if (process.env.CONDA_PREFIX && path.basename(process.env.CONDA_PREFIX) === envName) {
    prefixes.push(process.env.CONDA_PREFIX);
  }
  if (process.env.CONDA_EXE) {
    prefixes.push(path.join(path.dirname(path.dirname(process.env.CONDA_EXE)), "envs", envName));
  }
  for (const base of ["miniconda3", "anaconda3", "miniforge3", "mambaforge"]) {
    prefixes.push(path.join(os.homedir(), base, "envs", envName));
  }

  const executable = isWindows ? "python.exe" : path.join("bin", "python");
  for (const prefix of prefixes) {
    const candidate = path.join(prefix, executable);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "python";
}

// BLENDER_EXE, else the newest "Blender x.y" folder under Program Files, else `blender` on PATH.
export function findBlender() {
  if (process.env.BLENDER_EXE) return process.env.BLENDER_EXE;

  if (isWindows) {
    const base = path.join(process.env.ProgramFiles || "C:\\Program Files", "Blender Foundation");
    const byVersion = new Intl.Collator(undefined, { numeric: true }).compare;
    try {
      const versions = fs.readdirSync(base).filter((name) => /^blender/i.test(name)).sort(byVersion).reverse();
      for (const version of versions) {
        const candidate = path.join(base, version, "blender.exe");
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {
      // No Blender Foundation folder.
    }
  } else if (process.platform === "darwin") {
    const candidate = "/Applications/Blender.app/Contents/MacOS/Blender";
    if (fs.existsSync(candidate)) return candidate;
  }
  return "blender";
}

// `conda activate` puts an environment's DLL folders on PATH. Starting its python.exe directly
// skips that, and on Windows NumPy then crashes the first time it calls into MKL.
export function environmentFor(executable, base = process.env) {
  if (!isWindows || !path.isAbsolute(executable)) return { ...base };
  const prefix = path.dirname(executable);
  if (!fs.existsSync(path.join(prefix, "conda-meta"))) return { ...base };

  const folders = [prefix, ...["Library\\mingw-w64\\bin", "Library\\usr\\bin", "Library\\bin", "Scripts", "bin"].map((dir) => path.join(prefix, dir))];
  const pathKey = Object.keys(base).find((key) => key.toUpperCase() === "PATH") || "PATH";
  return { ...base, [pathKey]: [...folders, base[pathKey] || ""].join(path.delimiter), CONDA_PREFIX: prefix };
}

export function isExecutableFound(executable) {
  return path.isAbsolute(executable) ? fs.existsSync(executable) : null;
}
