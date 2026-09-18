from pathlib import Path
p = Path("src/components/cull/CullGrid.tsx")
text = p.read_text()
old1 = """<<<<<<< HEAD
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ImageOff, Layers, Tag, X } from "lucide-react";
=======
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ImageOff, Layers, X } from "lucide-react";
>>>>>>> origin/main"""
new1 = """import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ImageOff, Layers, Tag, X } from "lucide-react";"""
if old1 in text:
    text = text.replace(old1, new1, 1)
elif "<<<<<<<" not in text:
    print("no markers; assume resolved")
else:
    raise SystemExit("conflict 1 pattern mismatch")
start = text.find("<<<<<<< HEAD\n/** A long file name")
if start >= 0:
    end = text.find(">>>>>>> origin/main\n", start)
    if end < 0:
        raise SystemExit("conflict 2 end missing")
    end = end + len(">>>>>>> origin/main\n")
    block = text[start:end]
    mid = block.find("=======\n")
    head_part = block[len("<<<<<<< HEAD\n"):mid]
    main_part = block[mid + len("=======\n"):block.find(">>>>>>> origin/main\n")]
    resolved = head_part.rstrip() + "\n\n" + main_part.lstrip()
    if not resolved.endswith("\n"):
        resolved += "\n"
    text = text[:start] + resolved + text[end:]
if "<<<<<<<" in text or ">>>>>>>" in text:
    raise SystemExit("markers remain after resolve")
p.write_text(text)
print("CullGrid resolved", len(text.splitlines()), "lines")
