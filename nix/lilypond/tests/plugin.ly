\version "2.27.2"
\include "lpcs.ily"

\csoundExportOptions #'(
  (strict . #t)
  (adapter-instrument . 17)
  (target . "trace")
  (emit-timeline . #t)
)

\score {
  \new Staff {
    \new Voice = "lead" {
      \csoundUnfoldForExport {
        \tempo 4 = 90
        c'4~ c'4-.
        d'4(-> e'4)
      }
    }
  }
  \layout { }
}
