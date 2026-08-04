export const PLAYBACK_WAV_FILE = "lpcs-playback.wav";

const instrument17Pattern = /^\s*i\s+17(?:\.\d+)?(?:\s|$)/m;
const orchestraInstrument17Pattern = /^\s*instr\s+17(?:\.\d+)?(?:\s|$)/mi;
const csdTagPattern =
  /<\/?(?:CsoundSynthesizer|CsOptions|CsInstruments|CsScore)\s*>/i;

export function createPlaybackCsd(score: string, orchestra: string) {
  const cleanScore = score.trim();
  const cleanOrchestra = orchestra.trim();

  if (!cleanScore) {
    throw new Error("The LilyPond Csound score is empty.");
  }
  if (csdTagPattern.test(cleanScore)) {
    throw new Error("The LilyPond output must be a Csound score, not a CSD file.");
  }
  if (!instrument17Pattern.test(cleanScore)) {
    throw new Error(
      "The score has no instrument 17 events. Set adapter-instrument to 17 in \\csoundExportOptions.",
    );
  }
  if (!cleanOrchestra) {
    throw new Error("The Csound orchestra is empty.");
  }
  if (csdTagPattern.test(cleanOrchestra)) {
    throw new Error("The Csound orchestra must be orchestra text, not a CSD file.");
  }
  if (!orchestraInstrument17Pattern.test(cleanOrchestra)) {
    throw new Error(
      "The Csound orchestra must define instrument 17 for LPCS events.",
    );
  }

  return `<CsoundSynthesizer>
<CsOptions>
-d -m128 -W -s -o${PLAYBACK_WAV_FILE}
</CsOptions>
<CsInstruments>
${cleanOrchestra}
</CsInstruments>
<CsScore>
${cleanScore}
</CsScore>
</CsoundSynthesizer>
`;
}
