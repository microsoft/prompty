namespace Prompty.Core
{
    /// <summary>
    /// Utility class for file operations to provide compatibility with .NET Standard 2.0
    /// </summary>
    internal class FileUtils
    {
        internal static string GetFullPath(string path, string parentPath)
        {
#if NET
            return Path.GetFullPath(path, parentPath);
#else
            if (!string.IsNullOrEmpty(parentPath))
                path = Path.Combine(parentPath, path);
            return Path.GetFullPath(path);
#endif
        }

        internal static Task<string> ReadAllTextAsync(string path, CancellationToken cancellationToken = default(CancellationToken))
        {
#if NET
            return File.ReadAllTextAsync(path, cancellationToken);
#else
            return Task.FromResult(File.ReadAllText(path));
#endif
        }

        internal static Task<byte[]> ReadAllBytesAsync(string path, CancellationToken cancellationToken = default(CancellationToken))
        {
#if NET
            return File.ReadAllBytesAsync(path, cancellationToken);
#else
            return Task.FromResult(File.ReadAllBytes(path));
#endif
        }
    }
}
