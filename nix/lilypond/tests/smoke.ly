\version "2.27.2"

#(for-each
   (lambda (font)
     (let* ((family (car font))
            (expected (cdr font))
            (actual
              ((@@ (lily) ly:font-config-get-font-file) family)))
       (unless
         (string=? actual expected)
         (ly:error
           "~a resolved outside the LilyPond bundle: ~s"
           family
           actual))))
   '(("C059" . "/lilypond/fonts/text/C059-Roman.otf")
     ("Nimbus Sans" . "/lilypond/fonts/text/NimbusSans-Regular.otf")
     ("Nimbus Mono PS" . "/lilypond/fonts/text/NimbusMonoPS-Regular.otf")
     ("DejaVu Serif" . "/lilypond/fonts/text/DejaVuSerif.ttf")
     ("serif" . "/lilypond/fonts/text/C059-Roman.otf")
     ("sans" . "/lilypond/fonts/text/NimbusSans-Regular.otf")
     ("monospace" . "/lilypond/fonts/text/NimbusMonoPS-Regular.otf")))

\header {
  title = "WASI Text"
  tagline = ##f
}

\score {
  \new Staff <<
    \new Voice = "melody" {
      c'4 d' e' f'
    }
    \new Lyrics \lyricsto "melody" {
      Bun -- dled text works.
    }
  >>
}
