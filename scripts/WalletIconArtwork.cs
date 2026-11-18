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
        var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bitmap))
        using (var edge = new SolidBrush(dark))
        using (var snap = new SolidBrush(light))
        using (var rear = Matte(mid, 55, 16))
        using (var front = Matte(light, 55, 16))
        using (var body = Matte(light, 88, 25))
        using (var clasp = Matte(mid, 88, 25))
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
        return bitmap;
    }
}
