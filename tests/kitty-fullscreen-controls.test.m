#import "../kitty/fullscreen-controls.m"
#include <assert.h>

@interface TestWindow : NSWindow
@property NSUInteger exits;
@property NSUInteger minimizes;
@end
@implementation TestWindow
- (NSScreen *)screen { return NSScreen.mainScreen; }
- (void)toggleFullScreen:(id)sender { (void)sender; self.exits++; }
- (void)miniaturize:(id)sender { (void)sender; self.minimizes++; }
@end

static NSUInteger releasedControllers;
@interface TestControls : ShellOSFullscreenControls
@end
@implementation TestControls
- (void)dealloc { releasedControllers++; [super dealloc]; }
@end

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        NSScreen *screen = NSScreen.mainScreen;
        assert(screen != nil);
        NSRect testFrame = NSMakeRect(NSMinX(screen.frame) - 2000, NSMinY(screen.frame),
                                     800, NSHeight(screen.frame));
        TestWindow *window = [[TestWindow alloc] initWithContentRect:testFrame
            styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        window.releasedWhenClosed = NO;
        window.opaque = NO;
        window.backgroundColor = [NSColor colorWithWhite:0.1 alpha:0.82];
        NSRect original = window.frame;
        __block NSUInteger closeRequests = 0;
        @autoreleasepool {
            TestControls *controls = [[TestControls alloc] initWithWindow:window
                closeHandler:^{ closeRequests++; }];
            NSPanel *panel = [controls valueForKey:@"panel"];
            NSView *bar = panel.contentView;
            NSPoint top = NSMakePoint(NSMidX(original), NSMaxY(original) - 1);
            NSPoint middle = NSMakePoint(NSMidX(original), NSMidY(original));
            assert(bar.hidden);
            [controls start];
            [controls updateAtPoint:middle active:YES mouseButtons:0];
            assert(bar.hidden);
            [controls updateAtPoint:top active:YES mouseButtons:1];
            assert(bar.hidden);
            [controls updateAtPoint:top active:YES mouseButtons:0];
            assert(!bar.hidden && bar.subviews.count == 3);
            assert(panel.parentWindow == window && !panel.canBecomeKeyWindow);
            assert(NSEqualRects(original, window.frame) && !window.opaque);
            NSRect barFrame = panel.frame;
            assert(NSMaxY(barFrame) <= NSMaxY(original) - NSStatusBar.systemStatusBar.thickness);
            NSPoint buttonPoint = NSMakePoint(NSMinX(barFrame) + 20, NSMidY(barFrame));
            [controls updateAtPoint:buttonPoint active:YES mouseButtons:0];
            assert(!bar.hidden);
            [controls updateAtPoint:buttonPoint active:NO mouseButtons:0];
            assert(bar.hidden);
            assert(panel.parentWindow == nil);
            [controls updateAtPoint:top active:YES mouseButtons:0];
            [controls updateAtPoint:middle active:YES mouseButtons:0];
            assert(bar.hidden);
            [controls updateAtPoint:NSMakePoint(NSMaxX(original) + 1, top.y) active:YES mouseButtons:0];
            assert(bar.hidden);
            NSRect safeFrame = original;
            safeFrame.size.height -= 40;
            [window setFrame:safeFrame display:NO];
            [controls updateAtPoint:top active:YES mouseButtons:0];
            assert(!bar.hidden && NSMaxY(panel.frame) == NSMaxY(safeFrame));
            [window setFrame:original display:NO];
            [controls updateAtPoint:top active:YES mouseButtons:0];
            [(NSButton *)bar.subviews[0] performClick:nil];
            assert(closeRequests == 1 && window.exits == 0);
            [(NSButton *)bar.subviews[2] performClick:nil];
            assert(window.exits == 1 && window.minimizes == 0);
            [(NSButton *)bar.subviews[1] performClick:nil];
            assert(window.exits == 2 && window.minimizes == 1);
            [controls invalidate];
            assert(window.childWindows.count == 0);
            [controls release];
        }
        assert(releasedControllers == 1);
        [window close];
        [window release];
        puts("kitty fullscreen controls: PASS");
    }
}
