from pathlib import Path

root = Path("patches/dashboard-mobile-drawer")

# --- AppDashboard.tsx ---
path = Path("src/components/dashboard/AppDashboard.tsx")
text = path.read_text()

old_lucide = """import {
  Aperture,
  ArrowUp,
  CalendarDays,
  ChartNoAxesColumn,
  Copy,
  Download,
  House,
  Images,
  Moon,
  PanelLeft,
  Plus,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Wrench,
} from \"lucide-react\";"""
new_lucide = old_lucide.replace("  Images,\n  Moon,", "  Images,\n  Menu,\n  Moon,")
if old_lucide not in text:
    raise SystemExit("lucide import block missing")
text = text.replace(old_lucide, new_lucide)

needle = 'import { useIsMobile } from "@/hooks/use-mobile";\n'
if 'from "@/components/ui/sheet"' not in text:
    text = text.replace(
        needle,
        needle
        + 'import {\n  Sheet,\n  SheetContent,\n  SheetDescription,\n  SheetHeader,\n  SheetTitle,\n} from "@/components/ui/sheet";\n',
        1,
    )

old_state = """  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startW: number } | null>(null);"""
new_state = """  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ startX: number; startW: number } | null>(null);"""
text = text.replace(old_state, new_state)

old_mobile_effect = """  useEffect(() => {
    if (!mobile) return;
    drag.current = null;
    detachResize();
    liveRef.current = null;
    setLiveWidth(null);
  }, [mobile]);"""
new_mobile_effect = """  useEffect(() => {
    if (!mobile) {
      setMobileNavOpen(false);
      return;
    }
    drag.current = null;
    detachResize();
    liveRef.current = null;
    setLiveWidth(null);
  }, [mobile]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, search]);"""
text = text.replace(old_mobile_effect, new_mobile_effect)

old_shown = """  // Narrow-screen presentation is temporary; retain the user's desktop rail settings.
  const shown = mobile ? MINI_W : shownWidth();
  const visual = mobile ? "mini" : liveWidth == null ? rail : widthToMode(liveWidth);"""
new_shown = """  // Narrow screens hide the permanent rail; desktop settings stay untouched in memory.
  const shown = mobile ? 0 : shownWidth();
  const visual = mobile ? "open" : liveWidth == null ? rail : widthToMode(liveWidth);"""
text = text.replace(old_shown, new_shown)

start = text.index("  return (\n    <DashboardContext.Provider value={true}>")
end = text.index("        <main\n          className={`celinen-dash__body")
prefix = (root / "rail-prefix.txt").read_text()
text = text[:start] + prefix + text[end:]

old_theme = """        <main
          className={`celinen-dash__body${children ? " is-tool" : calendarOpen ? " is-cal" : " is-chat"}`}
        >
          {account && account.status === "in" ? (
            <div className="celinen-dash__theme" role="group" aria-label="Appearance">"""
ham = (root / "ham-insert.txt").read_text()
new_theme = """        <main
          className={`celinen-dash__body${children ? " is-tool" : calendarOpen ? " is-cal" : " is-chat"}`}
        >
""" + ham + """          {account && account.status === "in" ? (
            <div className="celinen-dash__theme" role="group" aria-label="Appearance">"""
if old_theme not in text:
    raise SystemExit("theme block missing")
text = text.replace(old_theme, new_theme)
path.write_text(text)
print("patched", path)

# --- dashboard.css ---
css_path = Path("src/components/dashboard/dashboard.css")
css = css_path.read_text()
old_media_start = "/* Match useIsMobile without overwriting the saved desktop --rail width. */"
if old_media_start not in css:
    if "celinen-dash__drawer" not in css:
        raise SystemExit("css marker missing")
    print("css already patched")
else:
    # replace from marker through EOF with css-tail
    idx = css.index(old_media_start)
    css_path.write_text(css[:idx] + (root / "css-tail.txt").read_text())
    print("patched", css_path)

# --- tests ---
test_dest = Path("tests/dashboard-mobile-layout.test.ts")
test_dest.write_text((root / "dashboard-mobile-layout.test.ts").read_text())
print("wrote", test_dest)
