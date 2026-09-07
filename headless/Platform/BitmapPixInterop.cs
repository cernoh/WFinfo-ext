using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

namespace Tesseract
{
    /// <summary>
    /// Bridges System.Drawing.Bitmap into the Tesseract engine for the headless
    /// build. The official Tesseract NuGet (netstandard2.0) has no System.Drawing
    /// dependency, so the Bitmap overloads the .NET Framework build enjoys do not
    /// exist there. PNG round-tripping is lossless and avoids a GDI+ pixel-copy
    /// dependency; leptonica decodes it natively.
    ///
    /// Only compiled into the headless assembly; never used by the Windows app.
    /// </summary>
    internal static class BitmapPixInterop
    {
        private static Pix ToPix(Bitmap bitmap)
        {
            using (var stream = new MemoryStream())
            {
                bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
                stream.Position = 0;
                return Pix.LoadFromMemory(stream.ToArray());
            }
        }

        public static Page Process(this TesseractEngine engine, Bitmap image, PageSegMode pageSegMode)
            => engine.Process(ToPix(image), pageSegMode);

        public static Page Process(this TesseractEngine engine, Bitmap image)
            => engine.Process(ToPix(image), PageSegMode.Auto);
    }
}
