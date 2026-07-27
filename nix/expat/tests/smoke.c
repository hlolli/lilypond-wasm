#include <stdio.h>
#include <string.h>

#include <expat.h>

struct parse_state
{
  int depth;
  int starts;
  int ends;
  int saw_fontconfig;
  int saw_prefix;
  int saw_family;
  char text[128];
  size_t text_size;
};

static const char *
attribute_value (const XML_Char **attributes, const char *name)
{
  size_t index;

  for (index = 0; attributes[index] != NULL; index += 2)
    if (strcmp (attributes[index], name) == 0)
      return attributes[index + 1];

  return NULL;
}

static void XMLCALL
start_element (void *user_data, const XML_Char *name,
               const XML_Char **attributes)
{
  struct parse_state *state = user_data;
  const char *value;

  state->starts++;
  state->depth++;

  if (strcmp (name, "fontconfig") == 0)
    state->saw_fontconfig = 1;
  else if (strcmp (name, "dir") == 0)
    {
      value = attribute_value (attributes, "prefix");
      if (value != NULL && strcmp (value, "cwd") == 0)
        state->saw_prefix = 1;
    }
  else if (strcmp (name, "test") == 0)
    {
      value = attribute_value (attributes, "name");
      if (value != NULL && strcmp (value, "family") == 0)
        state->saw_family = 1;
    }
}

static void XMLCALL
end_element (void *user_data, const XML_Char *name)
{
  struct parse_state *state = user_data;

  (void) name;
  state->ends++;
  state->depth--;
}

static void XMLCALL
character_data (void *user_data, const XML_Char *text, int length)
{
  struct parse_state *state = user_data;
  size_t size = (size_t) length;

  if (state->text_size + size >= sizeof (state->text))
    return;

  memcpy (state->text + state->text_size, text, size);
  state->text_size += size;
  state->text[state->text_size] = '\0';
}

static int
parse_chunk (XML_Parser parser, const char *chunk, int size, int is_final)
{
  if (XML_Parse (parser, chunk, size, is_final) == XML_STATUS_OK)
    return 1;

  fprintf (stderr, "XML parse failed at line %lu: %s\n",
           XML_GetCurrentLineNumber (parser),
           XML_ErrorString (XML_GetErrorCode (parser)));
  return 0;
}

static int
rejects_malformed_xml (void)
{
  static const char malformed[]
    = "<fontconfig><dir>fonts</fontconfig>";
  XML_Parser parser = XML_ParserCreate (NULL);
  enum XML_Status status;
  enum XML_Error error;

  if (parser == NULL)
    return 0;

  status = XML_Parse (parser, malformed, sizeof (malformed) - 1, XML_TRUE);
  error = XML_GetErrorCode (parser);
  XML_ParserFree (parser);

  return status == XML_STATUS_ERROR && error == XML_ERROR_TAG_MISMATCH;
}

int
main (void)
{
  static const char document[]
    = "<fontconfig><dir prefix=\"cwd\">fonts</dir>"
      "<match target=\"pattern\"><test name=\"family\">"
      "<string>Noto Sans μουσική</string></test></match></fontconfig>";
  static const char expected_text[] = "fontsNoto Sans μουσική";
  struct parse_state state = { 0 };
  const char *unicode;
  size_t split;
  XML_Parser parser;
  int passed;

  unicode = strstr (document, "μουσική");
  if (unicode == NULL)
    {
      fputs ("could not find the Unicode split point\n", stderr);
      return 1;
    }

  /* Split inside the first UTF-8 character to test streamed input. */
  split = (size_t) (unicode - document) + 1;

  parser = XML_ParserCreate (NULL);
  if (parser == NULL)
    {
      fputs ("XML_ParserCreate failed\n", stderr);
      return 1;
    }

  XML_SetUserData (parser, &state);
  XML_SetElementHandler (parser, start_element, end_element);
  XML_SetCharacterDataHandler (parser, character_data);

  passed = parse_chunk (parser, document, (int) split, XML_FALSE)
           && parse_chunk (parser, document + split,
                           (int) (sizeof (document) - 1 - split), XML_TRUE);

  XML_ParserFree (parser);

  if (!passed || state.depth != 0 || state.starts != 5 || state.ends != 5
      || !state.saw_fontconfig || !state.saw_prefix || !state.saw_family
      || strcmp (state.text, expected_text) != 0 || !rejects_malformed_xml ())
    {
      fputs ("streaming XML result did not match\n", stderr);
      return 1;
    }

  printf ("expat %d.%d.%d: streaming XML parse passed\n", XML_MAJOR_VERSION,
          XML_MINOR_VERSION, XML_MICRO_VERSION);
  return 0;
}
