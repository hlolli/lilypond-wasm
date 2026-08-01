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
  title = "LilyPond in the browser"
  subtitle = "A local WASI render"
  tagline = ##f
}

\paper {
  #(set-paper-size "a5")
}

\score {
  \new Staff {
    \new Voice = "melody" {
      \csoundUnfoldForExport {
        \relative c' {
          \key c \major
          \time 4/4
          c4 d e f |
          g2 g |
          a4 a g g |
          f1 \bar "|."
        }
      }
    }
  }
  \layout { }
}
`;
