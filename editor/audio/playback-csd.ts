export const PLAYBACK_WAV_FILE = "lpcs-playback.wav";

const instrument17Pattern = /^\s*i\s+17(?:\.\d+)?(?:\s|$)/m;
const csdTagPattern = /<\/?Csound(?:Synthesizer|Options|Instruments|Score)>/i;

export function createPlaybackCsd(score: string) {
  const cleanScore = score.trim();

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

  return `<CsoundSynthesizer>
<CsOptions>
-d -m128 -W -s -o${PLAYBACK_WAV_FILE}
</CsOptions>
<CsInstruments>
sr = 48000
ksmps = 64
nchnls = 2
0dbfs = 1
seed 17
giSine ftgen 0, 0, 16384, 10, 1

instr 17
  iDuration = abs(p3)
  if iDuration < 0.01 then
    iDuration = 0.01
  endif

  iAttack = 0.012
  if p17 > 0 then
    iAttack = 0.004
  endif

  iRelease = 0.08
  if p18 > 0 then
    iRelease = 0.16
  endif
  xtratim iRelease

  iTie tival
  iPhase = 0
  iEnvelopeStart = 0
  if iTie == 1 then
    iPhase = -1
    iEnvelopeStart = 1
  endif

  iLevel = p11
  if iLevel < 0 then
    iLevel = 0
  elseif iLevel > 1 then
    iLevel = 1
  endif

  kLevel linseg iLevel, iDuration, p12
  kPan linseg p14, iDuration, p15
  kPan = (kPan + 1) * 0.5
  kPan limit kPan, 0, 1
  aEnvelope linsegr iEnvelopeStart, iAttack, 1, iRelease, 0

  if p10 > 0 then
    iDrum = p10
    iCentre = 180
    if iDrum <= 36 then
      iCentre = 70
    elseif iDrum >= 42 then
      iCentre = 6200
    endif
    aNoise rand 0.42
    aBody reson aNoise, iCentre, iCentre * 0.65
    aTone oscili 0.22, iCentre, giSine, iPhase
    aSignal = (aBody + aTone) * aEnvelope * kLevel
  else
    kPitch linseg p8, iDuration, p9
    kFrequency = cpsmidinn(kPitch)
    aFundamental oscili 0.16, kFrequency, giSine, iPhase
    aOvertone oscili 0.035, kFrequency * 2, giSine, iPhase
    aSignal = (aFundamental + aOvertone) * aEnvelope * kLevel
  endif

  iGate = p13
  if iGate <= 0 then
    iGate = 1
  elseif iGate > 1 then
    iGate = 1
  endif
  kSegmentTime init 0
  kSegmentTime = kSegmentTime + (ksmps / sr)
  if p3 > 0 && kSegmentTime >= iDuration * iGate then
    turnoff
  endif

  aLeft, aRight pan2 aSignal, kPan
  outs aLeft, aRight
endin
</CsInstruments>
<CsScore>
${cleanScore}
</CsScore>
</CsoundSynthesizer>
`;
}
