export const STARTER_ORCHESTRA = `sr = 48000
ksmps = 64
nchnls = 2
0dbfs = 1
seed 17
giSine ftgen 0, 0, 16384, 10, 1

; LilyPond writes each LPCS note as a 28-field event for instr 17.
; Pitched notes put MIDI pitch in p8/p9 and set p10 to -1. Drums set
; p8/p9 to -1 and put their mapped drum id in p10.
; p11/p12 are levels from 0 to 1; p13 is the gate ratio. p17 is attack
; (0 normal, 1 accent, 2 marcato); p18 is release (0 normal, 1 tenuto).
; The score writes p2/p3 in quarter-note beats, then its tempo map scales
; them to seconds before instr 17 runs. A negative p3 continues a tie.
; Tied parts share the same fractional p1; tival reports later parts.
; p28 holds percent-encoded note metadata for tools; this orchestra ignores it.

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
`;
