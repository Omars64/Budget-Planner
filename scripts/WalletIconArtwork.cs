using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

// Coordinates are percentages of the approved square icon preview.
public static class WalletIconArtwork
{
    private static GraphicsPath Rounded(RectangleF rect, float topX, float topY,
        float bottomX, float bottomY, bool squareRight = false)
    {
        var path = new GraphicsPath();
        path.AddArc(rect.Left, rect.Top, 2 * topX, 2 * topY, 180, 90);
        if (squareRight)
        {
            path.AddLine(rect.Right, rect.Top, rect.Right, rect.Bottom);
        }
        else
        {
            path.AddArc(rect.Right - 2 * topX, rect.Top, 2 * topX, 2 * topY, 270, 90);
            path.AddArc(rect.Right - 2 * bottomX, rect.Bottom - 2 * bottomY,
                2 * bottomX, 2 * bottomY, 0, 90);
        }
        path.AddArc(rect.Left, rect.Bottom - 2 * bottomY, 2 * bottomX, 2 * bottomY, 90, 90);
        path.CloseFigure();
        return path;
    }

    // Fine, evenly distributed pigment grain. Rendering uses darker pixels only.
    private static TextureBrush Matte(Color color, float repeat, int depth)
    {
        const int size = 192;
        using (var tile = new Bitmap(size, size, PixelFormat.Format24bppRgb))
        {
            var noise = new Random(12029);
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    int intensity = 255 - noise.Next(depth);
                    tile.SetPixel(x, y, Color.FromArgb(
                        (color.R * intensity + 127) / 255, (color.G * intensity + 127) / 255,
                        (color.B * intensity + 127) / 255));
                }
            }
            var brush = new TextureBrush(tile, WrapMode.Tile);
            brush.ScaleTransform(repeat / size, repeat / size);
            return brush;
        }
    }

    private static void Shape(Graphics graphics, Brush edge, Brush fill, RectangleF rect,
        float topX, float topY, float bottomX, float bottomY, bool squareRight = false)
    {
        using (var outline = Rounded(rect, topX, topY, bottomX, bottomY, squareRight))
        {
            graphics.FillPath(edge, outline);
            const float border = 2;
            rect.Inflate(-border, -border);
            if (squareRight) rect.Width += border;
            using (var interior = Rounded(rect, topX - border, topY - border,
                bottomX - border, bottomY - border, squareRight))
                graphics.FillPath(fill, interior);
        }
    }

    private static void Card(Graphics graphics, Brush edge, Brush fill,
        RectangleF rect, float angle, float top, float bottom)
    {
        var state = graphics.Save();
        float cx = rect.X + rect.Width / 2;
        float cy = rect.Y + rect.Height / 2;
        graphics.TranslateTransform(cx, cy);
        graphics.RotateTransform(angle);
        graphics.TranslateTransform(-cx, -cy);
        Shape(graphics, edge, fill, rect, rect.Width * top, rect.Height * top,
            rect.Width * bottom, rect.Height * bottom);
        graphics.Restore(state);
    }

    public static Bitmap Render(Color dark, Color mid, Color light, int size, string platform)
    {
        return Render(dark, mid, light, size, platform, false);
    }

    public static Bitmap Render(Color dark, Color mid, Color light, int size, string platform, bool miami)
    {
        var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bitmap))
        using (var edge = new SolidBrush(dark))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.ScaleTransform(size / 100f, size / 100f);

            float scale = 1;
            var tile = new RectangleF(0, 0, 100, 100);
            switch (platform)
            {
                case "adaptive":
                    // Android masks the central 72 dp of its 108 dp foreground.
                    scale = .88f * 72 / 108;
                    break;
                case "android":
                    g.FillEllipse(edge, tile);
                    scale = .88f;
                    break;
                case "maskable":
                    g.Clear(dark);
                    scale = .88f;
                    break;
                default:
                    using (var tileShape = Rounded(tile, 24, 24, 24, 24))
                        g.FillPath(edge, tileShape);
                    break;
            }

            g.TranslateTransform(50, 50);
            g.ScaleTransform(scale, scale);
            g.TranslateTransform(-50, -50);

            if (miami) DrawMiamiWallet(g, edge, mid, light);
            else DrawWallet(g, edge, mid, light);
        }
        return bitmap;
    }

    private static void DrawWallet(Graphics g, Brush edge, Color mid, Color light)
    {
        using (var snap = new SolidBrush(light))
        using (var rear = Matte(mid, 55, 16))
        using (var front = Matte(light, 55, 16))
        using (var body = Matte(light, 88, 25))
        using (var clasp = Matte(mid, 88, 25))
        {
            Card(g, edge, rear, new RectangleF(19, 21, 45, 36), -44, .195f, .12f);
            Card(g, edge, front, new RectangleF(34, 20, 46, 43), -28, .205f, .14f);
            var wallet = new RectangleF(12.5f, 40, 75, 45);
            Shape(g, edge, body, wallet, 12, 12.15f, 12, 12.15f);
            wallet.Inflate(-2, -2);
            using (var interior = Rounded(wallet, 10, 10.15f, 10, 10.15f))
                g.SetClip(interior);
            var closure = new RectangleF(61.36f, 55.94f, 24.14f, 17.22f);
            Shape(g, edge, clasp, closure, 8.61f, 8.61f, 8.61f, 8.61f, true);
            g.FillEllipse(edge, 67.12f, 61.34f, 6.42f, 6.42f);
            g.FillEllipse(snap, 69.12f, 63.34f, 2.42f, 2.42f);
        }
    }

    // Etch a wind-bent palm into the wallet face, inside its existing silhouette.
    private static void Palm(Graphics g, Brush ink, float x, float y, float scale)
    {
        var transform = g.Save();
        g.TranslateTransform(x, y);
        g.ScaleTransform(scale, scale);
        using (var trunk = new GraphicsPath()) {
            trunk.AddBezier(-5, 33, -2, 23, 2, 14, 0, 0);
            trunk.AddBezier(0, 0, 4, 8, 4, 22, 0, 33);
            trunk.CloseFigure();
            g.FillPath(ink, trunk);
        }
        foreach (int angle in new int[] {-85,-56,-29,14,44,76}) {
            var crown = g.Save();
            g.RotateTransform(angle);
            using (var leaf = new GraphicsPath()) {
                leaf.AddBezier(0, 0, 2, -10, 8, -17, 17, -16);
                leaf.AddBezier(17, -16, 12, -15, 8, -9, 7, -7);
                leaf.AddLine(7, -7, 7, -10);
                leaf.AddBezier(7, -10, 5, -6, 2, -2, 0, 0);
                g.FillPath(ink, leaf);
            }
            g.Restore(crown);
        }
        g.Restore(transform);
    }

    private static void DrawMiamiWallet(Graphics g, Brush edge, Color pink, Color peach)
    {
        using (var detail = new SolidBrush(pink))
        using (var body = new SolidBrush(peach))
        {
            Card(g, edge, detail, new RectangleF(23, 25, 39, 28), -37, .20f, .20f);
            Card(g, edge, body, new RectangleF(36, 22, 42, 38), -19, .20f, .20f);
            var wallet = new RectangleF(14, 43, 72, 41);
            Shape(g, edge, body, wallet, 12.24f, 11.07f, 12.24f, 11.07f);
            wallet.Inflate(-2, -2);
            using (var inside = Rounded(wallet, 10.24f, 9.07f, 10.24f, 9.07f))
                g.SetClip(inside);
            Palm(g, detail, 33, 59, .84f);
            Palm(g, detail, 48, 68, .52f);
            Shape(g, edge, detail, new RectangleF(57, 54, 32, 21), 10, 10, 10, 10, true);
            g.FillEllipse(edge, 65, 62, 6, 6);
        }
    }
}
