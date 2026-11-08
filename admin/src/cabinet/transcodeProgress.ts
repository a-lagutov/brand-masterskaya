/** Parses FFmpeg duration and progress across arbitrary stdout/stderr chunk boundaries. */
export function transcodeProgress(report: (percent: number) => void) {
  let duration = 0;
  let diagnostics = '';
  let output = '';
  let previous = -1;
  return {
    /** Reads the input duration from FFmpeg's bounded diagnostic header. */
    stderr(chunk: string) {
      diagnostics = (diagnostics + chunk).slice(-8192);
      const match = diagnostics.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    },
    /** Reserves the final ten percent for encryption and atomic publication. */
    stdout(chunk: string) {
      output += chunk;
      const lines = output.split('\n');
      output = lines.pop()!.slice(-1024);
      for (const line of lines) {
        const match = line.match(/^out_time_us=(\d+)\s*$/);
        if (!match || duration <= 0) continue;
        const percent = Math.min(90, Math.floor((Number(match[1]) / 1_000_000 / duration) * 90));
        if (percent > previous) {
          previous = percent;
          report(percent);
        }
      }
    },
  };
}
