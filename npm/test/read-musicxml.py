"""Independent XML/timing checks for the compiler export tests."""
import json
import sys
import xml.etree.ElementTree as ET
from fractions import Fraction

root = ET.fromstring(sys.stdin.read())
assert root.tag == "score-partwise"
events = []
for part in root.findall("part"):
    origin = Fraction(0)
    divisions = None
    for measure in part.findall("measure"):
        cursor = extent = Fraction(0)
        anchor = None
        for item in measure:
            if item.tag == "attributes":
                value = item.findtext("divisions")
                if value is not None:
                    divisions = int(value)
                    assert divisions > 0
            elif item.tag in ("note", "forward", "backup"):
                duration = Fraction(int(item.findtext("duration")), divisions)
                assert duration > 0
                if item.tag == "backup":
                    cursor -= duration
                    anchor = None
                elif item.tag == "forward":
                    cursor += duration
                    anchor = None
                else:
                    if item.find("chord") is None:
                        anchor = cursor
                        cursor += duration
                    assert anchor is not None
                    pitch = item.find("pitch")
                    if pitch is not None:
                        midi = 12 * (int(pitch.findtext("octave")) + 1)
                        midi += {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[pitch.findtext("step")]
                        midi += int(pitch.findtext("alter", "0"))
                        events.append({"part": part.get("id"), "staff": item.findtext("staff"),
                                       "voice": item.findtext("voice"), "midi": midi,
                                       "start": float(origin + anchor), "duration": float(duration)})
                assert cursor >= 0
                extent = max(extent, cursor)
        origin += extent
print(json.dumps(events))
