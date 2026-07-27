#include <errno.h>
#include <stdio.h>
#include <string.h>

#include <gio/gio.h>
#include <glib-object.h>
#include <glib-unix.h>
#include <glib.h>

typedef struct
{
  GObject parent;
  gint value;
} WasiCounter;

typedef struct
{
  GObjectClass parent;
} WasiCounterClass;

enum
{
  PROP_0,
  PROP_VALUE,
  N_PROPERTIES,
};

enum
{
  SIGNAL_COMPUTE,
  N_SIGNALS,
};

static GParamSpec *properties[N_PROPERTIES];
static guint signals[N_SIGNALS];

G_DEFINE_TYPE (WasiCounter, wasi_counter, G_TYPE_OBJECT)

static int
fail (const char *message)
{
  fprintf (stderr, "%s\n", message);
  return 1;
}

static void
wasi_counter_set_property (GObject *object, guint property_id,
                           const GValue *value, GParamSpec *spec)
{
  WasiCounter *counter = (WasiCounter *) object;

  if (property_id == PROP_VALUE)
    counter->value = g_value_get_int (value);
  else
    G_OBJECT_WARN_INVALID_PROPERTY_ID (object, property_id, spec);
}

static void
wasi_counter_get_property (GObject *object, guint property_id, GValue *value,
                           GParamSpec *spec)
{
  WasiCounter *counter = (WasiCounter *) object;

  if (property_id == PROP_VALUE)
    g_value_set_int (value, counter->value);
  else
    G_OBJECT_WARN_INVALID_PROPERTY_ID (object, property_id, spec);
}

static void
wasi_counter_class_init (WasiCounterClass *class)
{
  GObjectClass *object_class = G_OBJECT_CLASS (class);

  object_class->set_property = wasi_counter_set_property;
  object_class->get_property = wasi_counter_get_property;

  properties[PROP_VALUE]
    = g_param_spec_int ("value", NULL, NULL, 0, 1000, 0,
                        G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS);
  g_object_class_install_properties (object_class, N_PROPERTIES, properties);

  signals[SIGNAL_COMPUTE]
    = g_signal_new ("compute", G_TYPE_FROM_CLASS (class), G_SIGNAL_RUN_LAST, 0,
                    NULL, NULL, g_cclosure_marshal_generic, G_TYPE_INT, 2,
                    G_TYPE_INT, G_TYPE_STRING);
}

static void
wasi_counter_init (WasiCounter *counter)
{
  counter->value = 0;
}

typedef struct
{
  GObject parent;
  WasiCounter *item;
} WasiCounterList;

typedef struct
{
  GObjectClass parent;
} WasiCounterListClass;

static void
wasi_counter_list_model_init (GListModelInterface *iface);

G_DEFINE_TYPE_WITH_CODE (
  WasiCounterList, wasi_counter_list, G_TYPE_OBJECT,
  G_IMPLEMENT_INTERFACE (G_TYPE_LIST_MODEL, wasi_counter_list_model_init))

static GType
wasi_counter_list_get_item_type (GListModel *model)
{
  (void) model;
  return wasi_counter_get_type ();
}

static guint
wasi_counter_list_get_n_items (GListModel *model)
{
  WasiCounterList *list = (WasiCounterList *) model;
  return list->item == NULL ? 0 : 1;
}

static gpointer
wasi_counter_list_get_item (GListModel *model, guint position)
{
  WasiCounterList *list = (WasiCounterList *) model;

  if (position != 0 || list->item == NULL)
    return NULL;

  return g_object_ref (list->item);
}

static void
wasi_counter_list_model_init (GListModelInterface *iface)
{
  iface->get_item_type = wasi_counter_list_get_item_type;
  iface->get_n_items = wasi_counter_list_get_n_items;
  iface->get_item = wasi_counter_list_get_item;
}

static void
wasi_counter_list_dispose (GObject *object)
{
  WasiCounterList *list = (WasiCounterList *) object;

  g_clear_object (&list->item);
  G_OBJECT_CLASS (wasi_counter_list_parent_class)->dispose (object);
}

static void
wasi_counter_list_class_init (WasiCounterListClass *class)
{
  GObjectClass *object_class = G_OBJECT_CLASS (class);
  object_class->dispose = wasi_counter_list_dispose;
}

static void
wasi_counter_list_init (WasiCounterList *list)
{
  list->item = g_object_new (wasi_counter_get_type (), "value", 11, NULL);
}

static gint
on_compute (WasiCounter *counter, gint delta, const gchar *text,
            gpointer user_data)
{
  (void) user_data;
  return counter->value + delta + (gint) g_utf8_strlen (text, -1);
}

static int
check_regex (void)
{
  GError *error = NULL;
  GRegex *regex;
  GMatchInfo *match = NULL;
  gchar *capture;
  gboolean matched;

  regex = g_regex_new ("^(?<latin>\\p{Latin}+)\\s+(?<greek>\\p{Greek}+)$",
                       G_REGEX_DEFAULT, G_REGEX_MATCH_DEFAULT, &error);
  if (regex == NULL || error != NULL)
    return fail ("g_regex_new failed");

  matched = g_regex_match (regex, "Lily μουσική", G_REGEX_MATCH_DEFAULT,
                           &match);
  if (!matched)
    return fail ("g_regex_match did not match Unicode text");

  capture = g_match_info_fetch_named (match, "greek");
  if (capture == NULL || strcmp (capture, "μουσική") != 0)
    return fail ("the named GLib regex capture did not match");

  g_free (capture);
  g_match_info_unref (match);
  g_regex_unref (regex);
  return 0;
}

static int
check_base64 (void)
{
  static const guchar input[] = "LilyPond";
  gchar *encoded = g_base64_encode (input, sizeof (input) - 1);
  int result = 0;

  if (strcmp (encoded, "TGlseVBvbmQ=") != 0)
    result = fail ("g_base64_encode returned the wrong text");

  g_free (encoded);
  return result;
}

static int
check_gobject (void)
{
  WasiCounter *counter;
  gint property_value = 0;
  gint signal_result = 0;

  counter = g_object_new (wasi_counter_get_type (), "value", 7, NULL);
  g_object_get (counter, "value", &property_value, NULL);
  if (property_value != 7)
    return fail ("the GObject property did not retain its value");

  g_signal_connect (counter, "compute", G_CALLBACK (on_compute), NULL);
  g_signal_emit (counter, signals[SIGNAL_COMPUTE], 0, 5, "μουσική",
                 &signal_result);
  if (signal_result != 19)
    return fail ("the libffi-backed GObject signal returned the wrong value");

  g_object_unref (counter);
  return 0;
}

typedef struct
{
  guint count;
  gboolean valid;
} ItemChange;

static void
on_items_changed (GListModel *model, guint position, guint removed,
                  guint added, gpointer user_data)
{
  ItemChange *change = user_data;

  (void) model;
  change->count++;
  change->valid = position == 0 && removed == 1 && added == 1;
}

static int
check_glistmodel (void)
{
  WasiCounterList *list;
  GObject *item;
  ItemChange change = { 0, FALSE };

  list = g_object_new (wasi_counter_list_get_type (), NULL);
  if (g_list_model_get_item_type (G_LIST_MODEL (list))
        != wasi_counter_get_type ()
      || g_list_model_get_n_items (G_LIST_MODEL (list)) != 1)
    return fail ("the GListModel metadata was wrong");

  item = g_list_model_get_item (G_LIST_MODEL (list), 0);
  if (item != G_OBJECT (list->item))
    return fail ("GListModel returned the wrong item");
  g_object_unref (item);

  g_signal_connect (list, "items-changed", G_CALLBACK (on_items_changed),
                    &change);
  g_list_model_items_changed (G_LIST_MODEL (list), 0, 1, 1);
  if (change.count != 1 || !change.valid)
    return fail ("the GListModel change signal was wrong");

  g_object_unref (list);
  return 0;
}

static int
check_gio_error (void)
{
  GError *error;

  error = g_error_new_literal (G_IO_ERROR, G_IO_ERROR_NOT_SUPPORTED,
                               "not supported");
  if (error == NULL || error->domain != G_IO_ERROR
      || error->code != G_IO_ERROR_NOT_SUPPORTED)
    return fail ("the GIO error domain was wrong");

  g_error_free (error);
  return 0;
}

static int
check_spawn_stub (void)
{
  gchar *argv[] = { (gchar *) "false", NULL };
  GError *error = NULL;
  gboolean spawned;

  spawned = g_spawn_sync (NULL, argv, NULL, G_SPAWN_DEFAULT, NULL, NULL, NULL,
                          NULL, NULL, &error);
  if (spawned || error == NULL || error->domain != G_SPAWN_ERROR
      || error->code != G_SPAWN_ERROR_FAILED)
    return fail ("g_spawn_sync did not return the WASI unsupported error");

  g_error_free (error);
  return 0;
}

static gpointer
thread_body (gpointer data)
{
  return data;
}

static int
check_wasi_platform (void)
{
  GMainContext *context;
  GThread *thread;
  GError *error = NULL;
  gchar *os_name;
  gchar *fd_path;
  int fds[2] = { -1, -1 };

  context = g_main_context_new ();
  if (context == NULL)
    return fail ("g_main_context_new failed");
  (void) g_main_context_iteration (context, FALSE);
  g_main_context_unref (context);

  thread = g_thread_try_new ("unsupported", thread_body, NULL, &error);
  if (thread != NULL || error == NULL || error->domain != G_THREAD_ERROR
      || error->code != G_THREAD_ERROR_AGAIN)
    return fail ("g_thread_try_new did not return the WASI unsupported error");
  g_clear_error (&error);

  errno = 0;
  if (g_unix_open_pipe (fds, O_CLOEXEC | O_NONBLOCK, &error)
      || error == NULL || error->domain != G_UNIX_ERROR || errno != ENOSYS)
    return fail ("g_unix_open_pipe did not return ENOSYS");
  g_clear_error (&error);

  if (g_unix_get_passwd_entry ("nobody", &error) != NULL || error == NULL
      || error->domain != G_UNIX_ERROR || errno != ENOSYS)
    return fail ("g_unix_get_passwd_entry did not return ENOSYS");
  g_clear_error (&error);

  fd_path = g_unix_fd_query_path (0, &error);
  if (fd_path != NULL || error == NULL || error->domain != G_FILE_ERROR
      || error->code != G_FILE_ERROR_NOSYS)
    return fail ("g_unix_fd_query_path did not return the WASI error");
  g_clear_error (&error);

  os_name = g_get_os_info (G_OS_INFO_KEY_ID);
  if (os_name == NULL || strcmp (os_name, "wasi") != 0)
    return fail ("g_get_os_info did not identify WASI");
  g_free (os_name);

  return 0;
}

int
main (void)
{
  if (check_regex () != 0 || check_base64 () != 0 || check_gobject () != 0
      || check_glistmodel () != 0 || check_gio_error () != 0
      || check_spawn_stub () != 0
      || check_wasi_platform () != 0)
    return 1;

  printf (
    "glib %d.%d.%d: regex, base64, GObject, GListModel and WASI stubs passed\n",
    GLIB_MAJOR_VERSION, GLIB_MINOR_VERSION, GLIB_MICRO_VERSION);
  return 0;
}
