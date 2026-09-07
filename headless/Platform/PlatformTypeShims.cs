// Compile-time shims for Windows-only framework types that leak into the shared
// WFInfo core sources (Ocr.cs, Data.cs, settings, tests).
//
// These types exist only so the shared sources type-check on net9.0/Linux.
// The Windows build (net48 + WPF/WinForms) never compiles this file, and the
// headless runtime never calls into real UI/Win32 machinery: every member here
// is either unused at runtime or a deliberate no-op.
//
// NOTE: defining types inside framework namespaces is intentional and scoped
// to this headless assembly; do not copy this pattern into production code.

namespace System.Windows
{
    /// <summary>Minimal stand-in for System.Windows.Point (WPF).</summary>
    public struct Point
    {
        public double X { get; set; }
        public double Y { get; set; }

        public Point(double x, double y)
        {
            X = x;
            Y = y;
        }
    }
}

namespace System.Windows.Input
{
    /// <summary>Members referenced by ApplicationSettings defaults only.</summary>
    public enum Key
    {
        None = 0,
        LeftShift = 160,
        RightShift = 161,
        LeftCtrl = 162,
        RightCtrl = 163,
        LeftAlt = 164,
        RightAlt = 165,
        OemTilde = 192,
        Snapshot = 44,
    }

    public enum MouseButton
    {
        Left,
        Right,
        Middle,
        XButton1,
        XButton2,
    }
}

namespace System.Windows.Forms
{
    /// <summary>Minimal stand-in for WinForms Screen (only the type shape is needed).</summary>
    public class Screen
    {
        public static Screen PrimaryScreen => new Screen();
    }

    /// <summary>Clipboard copy is a Windows GUI feature; no-op in headless runs.</summary>
    public static class Clipboard
    {
        public static void SetText(string text)
        {
            // Intentionally empty: headless OCR pipelines never copy to a clipboard.
        }
    }
}
