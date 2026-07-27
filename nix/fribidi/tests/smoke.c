#include <stdio.h>

#include <fribidi.h>

static int
fail (const char *message)
{
  fprintf (stderr, "%s\n", message);
  return 1;
}

int
main (void)
{
  static const FriBidiChar text[] = {
    'A', ' ', '(', 0x05d0, 0x05d1, ' ', '1', '2', ')', ' ', 'B'
  };
  static const FriBidiCharType expected_types[] = {
    FRIBIDI_TYPE_LTR,
    FRIBIDI_TYPE_WS,
    FRIBIDI_TYPE_ON,
    FRIBIDI_TYPE_RTL,
    FRIBIDI_TYPE_RTL,
    FRIBIDI_TYPE_WS,
    FRIBIDI_TYPE_EN,
    FRIBIDI_TYPE_EN,
    FRIBIDI_TYPE_ON,
    FRIBIDI_TYPE_WS,
    FRIBIDI_TYPE_LTR,
  };
  static const FriBidiLevel expected_levels[] = {
    0, 0, 0, 1, 1, 1, 2, 2, 0, 0, 0
  };
  FriBidiCharType types[sizeof (text) / sizeof (text[0])];
  FriBidiBracketType brackets[sizeof (text) / sizeof (text[0])];
  FriBidiLevel levels[sizeof (text) / sizeof (text[0])];
  FriBidiParType base_direction = FRIBIDI_PAR_ON;
  FriBidiLevel level_count;
  size_t index;

  fribidi_get_bidi_types (text, (FriBidiStrIndex) (sizeof (text)
                                                   / sizeof (text[0])),
                          types);
  for (index = 0; index < sizeof (text) / sizeof (text[0]); index++)
    if (types[index] != expected_types[index])
      return fail ("the bidi character types did not match");

  fribidi_get_bracket_types (
    text, (FriBidiStrIndex) (sizeof (text) / sizeof (text[0])), types,
    brackets);
  for (index = 0; index < sizeof (text) / sizeof (text[0]); index++)
    {
      FriBidiBracketType expected = FRIBIDI_NO_BRACKET;

      if (index == 2)
        expected = FRIBIDI_BRACKET_OPEN_MASK | (FriBidiBracketType) '(';
      else if (index == 8)
        expected = (FriBidiBracketType) '(';

      if (brackets[index] != expected)
        return fail ("the paired-bracket data did not match");
    }

  level_count = fribidi_get_par_embedding_levels_ex (
    types, brackets, (FriBidiStrIndex) (sizeof (text) / sizeof (text[0])),
    &base_direction, levels);
  if (level_count != 3 || base_direction != FRIBIDI_PAR_LTR)
    return fail ("the paragraph direction or maximum level did not match");

  for (index = 0; index < sizeof (text) / sizeof (text[0]); index++)
    if (levels[index] != expected_levels[index])
      return fail ("the embedding levels did not match");

  printf ("fribidi %s: bidi levels and bracket pairs passed\n",
          FRIBIDI_VERSION);
  return 0;
}
