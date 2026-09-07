using System;
using System.Collections.Generic;
using System.Drawing;

namespace WFInfo
{
    // ---------------------------------------------------------------------------
    // Compile-time shape stand-ins for WPF window/control classes referenced by
    // the shared core sources. Headless runs never reach these members (all OCR
    // test paths are UI-free); if one is ever invoked it fails loudly instead of
    // pretending to work.
    // ---------------------------------------------------------------------------

    internal class Overlay
    {
        public static bool rewardsDisplaying;

        public double Height { get; set; } = 235;
        public bool IsVisible { get; set; }

        public void LoadTextData(string name, string plat, string primeSetPlat, string ducats, string volume,
            bool vaulted, bool mastered, string partsOwned, string partsDetected, bool hideRewardInfo, bool doWarn)
            => throw NotSupported();

        public void toSnapit() => throw NotSupported();
        public void Resize(int width) => throw NotSupported();
        public void Display(int x, int y, int delayMs) => throw NotSupported();
        public void BestOwnedChoice() => throw NotSupported();
        public void BestDucatChoice() => throw NotSupported();
        public void BestPlatChoice() => throw NotSupported();

        private static NotSupportedException NotSupported()
            => new NotSupportedException("UI surface is not available in the headless build.");
    }

    internal class SnapItOverlayWindow
    {
        public Bitmap tempImage;
        public double Left { get; set; }
        public double Top { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
        public bool Topmost { get; set; }
        public bool Focusable { get; set; }

        public void Populate(Bitmap image) => throw NotSupported();
        public void Show() => throw NotSupported();
        public void Focus() => throw NotSupported();

        private static NotSupportedException NotSupported()
            => new NotSupportedException("UI surface is not available in the headless build.");
    }

    /// <summary>Reward window reached through <c>Main.window</c> in shared code.</summary>
    internal class RewardWindow
    {
        public void loadTextData(string name, string plat, string primeSetPlat, string ducats, string volume,
            bool vaulted, bool mastered, string partsOwned, int partNumber, bool windowDisplay, bool hideRewardInfo)
            => throw new NotSupportedException("UI surface is not available in the headless build.");
    }

    internal class RewardCollection
    {
        public List<string> PrimeNames { get; } = new List<string>();
    }

    internal class ListingHelper
    {
        public List<List<string>> PrimeRewards { get; } = new List<List<string>>();
        public int SelectedRewardIndex { get; set; }
        public List<KeyValuePair<string, RewardCollection>> ScreensList { get; } = new List<KeyValuePair<string, RewardCollection>>();
        public bool Topmost { get; set; }

        public RewardCollection GetRewardCollection(List<string> rewards)
            => throw new NotSupportedException("WFM listing UI is not available in the headless build.");

        public void SetScreen(int index) => throw new NotSupportedException("UI surface is not available in the headless build.");
        public void Show() => throw new NotSupportedException("UI surface is not available in the headless build.");
    }

    internal class AutoCount
    {
        public AutoAddViewModel viewModel { get; } = new AutoAddViewModel();
        public static void ShowAutoCount() => throw new NotSupportedException("UI surface is not available in the headless build.");
    }

    internal class AutoAddViewModel
    {
        public void addItem(AutoAddSingleItem item) => throw new NotSupportedException("UI surface is not available in the headless build.");
    }

    internal class AutoAddSingleItem
    {
        public AutoAddSingleItem(List<string> rewardscreen, int selectedRewardIndex, AutoAddViewModel viewModel) { }
    }

    internal class ErrorDialogue
    {
        public ErrorDialogue(DateTime time, int durationMs) { }
    }

    internal class MainWindow
    {
        public static MainWindow INSTANCE { get; } = new MainWindow();
        public UIControl ReloadMarket { get; } = new UIControl();
        public UIControl MarketData { get; } = new UIControl();
        public UIControl DropData { get; } = new UIControl();

        internal class UIControl
        {
            public bool IsEnabled { get; set; }
            public object Content { get; set; }
        }
    }

    internal class EquipmentWindow
    {
        public static EquipmentWindow INSTANCE { get; } = new EquipmentWindow();
        public void reloadItems() => throw new NotSupportedException("UI surface is not available in the headless build.");
    }

    internal static class VerifyCount
    {
        public static void ShowVerifyCount(List<InventoryItem> items)
            => throw new NotSupportedException("UI surface is not available in the headless build.");
    }
}
