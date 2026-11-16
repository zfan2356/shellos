// ShellOS: hover controls for transparent, traditional macOS fullscreen.
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

@interface ShellOSFullscreenPanel : NSPanel
@end
@implementation ShellOSFullscreenPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

@interface ShellOSFullscreenControls : NSObject {
    NSWindow *owner;
    ShellOSFullscreenPanel *panel;
    NSVisualEffectView *bar;
    NSTimer *timer;
    void (^requestClose)(void);
}
- (instancetype)initWithWindow:(NSWindow *)window closeHandler:(void (^)(void))handler;
- (void)start;
- (void)invalidate;
- (void)updateAtPoint:(NSPoint)point active:(BOOL)active mouseButtons:(NSUInteger)buttons;
@end

@implementation ShellOSFullscreenControls
- (instancetype)initWithWindow:(NSWindow *)window closeHandler:(void (^)(void))handler {
    self = [super init];
    if (self) {
        owner = window;
        requestClose = [handler copy];
        bar = [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
        bar.identifier = @"shellos-fullscreen-controls";
        bar.material = NSVisualEffectMaterialTitlebar;
        bar.blendingMode = NSVisualEffectBlendingModeBehindWindow;
        bar.state = NSVisualEffectStateActive;
        bar.hidden = YES;
        NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                                  NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
        NSArray *labels = @[@"Close Window", @"Minimize Window", @"Exit Full Screen"];
        SEL actions[] = {@selector(closeWindow:), @selector(minimizeWindow:), @selector(exitFullscreen:)};
        NSWindowButton types[] = {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton};
        for (NSUInteger i = 0; i < 3; i++) {
            NSButton *button = [NSWindow standardWindowButton:types[i] forStyleMask:style];
            button.frame = NSMakeRect(14 + 22 * i, 12, 14, 14);
            button.target = self;
            button.action = actions[i];
            button.enabled = YES;
            button.toolTip = labels[i];
            button.accessibilityLabel = labels[i];
            [bar addSubview:button];
        }
        // A child panel stays above OpenGL without changing its layer hierarchy.
        panel = [[ShellOSFullscreenPanel alloc] initWithContentRect:NSZeroRect
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
            backing:NSBackingStoreBuffered defer:NO];
        panel.releasedWhenClosed = NO;
        panel.opaque = NO;
        panel.backgroundColor = NSColor.clearColor;
        panel.hidesOnDeactivate = YES;
        panel.hasShadow = NO;
        panel.contentView = bar;
    }
    return self;
}

- (void)start {
    if (timer) return;
    // Menu-bar tracking can swallow mouse events before the terminal sees them.
    timer = [[NSTimer alloc] initWithFireDate:[NSDate dateWithTimeIntervalSinceNow:0.1]
        interval:0.1 target:self selector:@selector(tick:) userInfo:nil repeats:YES];
    timer.tolerance = 0.025;
    [[NSRunLoop mainRunLoop] addTimer:timer forMode:NSRunLoopCommonModes];
}

- (void)tick:(NSTimer *)sender {
    (void)sender;
    BOOL active = NSApp.active && owner.keyWindow && owner.visible && !owner.miniaturized;
    [self updateAtPoint:[NSEvent mouseLocation] active:active mouseButtons:[NSEvent pressedMouseButtons]];
}

- (void)updateAtPoint:(NSPoint)point active:(BOOL)active mouseButtons:(NSUInteger)buttons {
    NSRect frame = owner.frame, screen = owner.screen.frame;
    CGFloat gap = MAX(0, NSMaxY(screen) - NSMaxY(frame));
    CGFloat menuInset = MAX(0, NSStatusBar.systemStatusBar.thickness - gap);
    const CGFloat height = 38;
    NSRect barOnScreen = NSMakeRect(NSMinX(frame), NSMaxY(frame) - menuInset - height,
                                    NSWidth(frame), height);
    if (!NSEqualRects(panel.frame, barOnScreen)) [panel setFrame:barOnScreen display:NO];
    CGFloat lowerEdge = bar.hidden ? NSMaxY(frame) - 8 : NSMinY(barOnScreen) - 10;
    BOOL inside = point.x >= NSMinX(frame) && point.x < NSMaxX(frame) &&
                  point.y >= lowerEdge && point.y <= NSMaxY(screen);
    // Do not reveal buttons under an ongoing terminal selection or drag.
    if (!active || !inside) {
        bar.hidden = YES;
        [owner removeChildWindow:panel];
        [panel orderOut:nil];
    } else if (!buttons && bar.hidden) {
        bar.hidden = NO;
        [owner addChildWindow:panel ordered:NSWindowAbove];
        [panel orderFront:nil];
    }
}

- (void)closeWindow:(id)sender {
    (void)sender;
    // Keep kitty's close-request path, including running-command confirmation.
    [self retain];
    requestClose();
    [self release];
}

- (void)exitFullscreen:(id)sender {
    (void)sender;
    [self retain];
    [owner toggleFullScreen:self];
    [self release];
}

- (void)minimizeWindow:(id)sender {
    (void)sender;
    [self retain];
    NSWindow *window = [owner retain];
    [window toggleFullScreen:self];
    [window miniaturize:self];
    [window release];
    [self release];
}

- (void)invalidate {
    [timer invalidate];
    [timer release];
    timer = nil;
    [owner removeChildWindow:panel];
    [panel orderOut:nil];
}

- (void)dealloc {
    [bar release];
    [panel release];
    [requestClose release];
    [super dealloc];
}
@end
