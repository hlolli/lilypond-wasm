import { lilypondVersion } from "@hlolli/lilypond-wasm";

export const defaultSource = String.raw`\version "${lilypondVersion}"
\include "lpcs.ily"

\csoundExportOptions #'(
  (strict . #t)
  (adapter-instrument . 17)
  (target . "trace")
  (emit-timeline . #t)
)

\header {
  title = "Evening miniature"
  subtitle = "For piano · hlolli_wg_piano"
  tagline = ##f
}

\paper {
  #(set-paper-size "a5")
}

rightHand = \relative c'' {
  \key c \major
  \time 3/4
  \tempo "Andante" 4 = 84
  e4\mp( g8 f e d) |
  c4( e g) |
  a4\mf( c8 b a g) |
  f2( e4) |
  d4\mp( f8 e d c) |
  b4( d g) |
  e2\p( d4) |
  c2. \bar "|."
}

leftHand = \relative c {
  \clef bass
  \key c \major
  \time 3/4
  c8\p g' e' g, e' g, |
  c, g' e' g, e' g, |
  f, a c a c a |
  f a c a c a |
  g b d b d b |
  g b d b d b |
  c g' e' g, d' g, |
  <c, g' e'>2.
}

\score {
  \new PianoStaff <<
    \new Staff = "right" {
      \new Voice = "rightHand" { \csoundUnfoldForExport { \rightHand } }
    }
    \new Staff = "left" {
      \new Voice = "leftHand" { \csoundUnfoldForExport { \leftHand } }
    }
  >>
  \layout { }
}
`;
