#import <Cocoa/Cocoa.h>
#define GLFW_INCLUDE_NONE
#include "../third-party/kitty/kitty/monotonic.h"
#include "../third-party/kitty/glfw/glfw3.h"
#include <assert.h>

extern id glfwGetCocoaWindow(GLFWwindow *);
typedef bool (*FullscreenCallback)(GLFWwindow *);
extern FullscreenCallback glfwSetCocoaToggleFullscreenIntercept(GLFWwindow *, FullscreenCallback);
static NSUInteger closeRequests, fullscreenRequests;

static void onClose(GLFWwindow *window) {
    (void)window;
    closeRequests++;
}

static bool toggle(GLFWwindow *window) {
    fullscreenRequests++;
    glfwToggleFullscreen(window, 0);
    return true;
}

static void drainEvents(void) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.12]];
}

static NSPanel *controlsPanel(void) {
    for (NSWindow *window in NSApp.windows) {
        if ([window isKindOfClass:NSClassFromString(@"ShellOSFullscreenPanel")]) return (NSPanel *)window;
    }
    return nil;
}

int main(void) {
    @autoreleasepool {
        bool occlusion;
        glfwInitHint(GLFW_COCOA_MENUBAR, false);
        glfwInitHint(GLFW_COCOA_CHDIR_RESOURCES, false);
        assert(glfwInit(0, &occlusion));
        NSApplicationPresentationOptions original = NSApp.presentationOptions;
        glfwWindowHint(GLFW_VISIBLE, false);
        glfwWindowHint(GLFW_FOCUSED, false);
        glfwWindowHint(GLFW_TRANSPARENT_FRAMEBUFFER, true);
        glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
        glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
        glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
        glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, true);
        GLFWwindow *window = glfwCreateWindow(640, 400, "ShellOS backend test", NULL, NULL, NULL);
        assert(window);
        glfwSetWindowCloseCallback(window, onClose);
        glfwSetCocoaToggleFullscreenIntercept(window, toggle);
        NSWindow *native = glfwGetCocoaWindow(window);
        assert(!native.opaque && !native.visible);
        @autoreleasepool {
            assert(glfwToggleFullscreen(window, 0));
            drainEvents();
            NSPanel *panel = controlsPanel();
            assert(panel != nil && panel.contentView.hidden && !panel.visible);
            assert(!native.opaque && glfwGetWindowAttrib(window, GLFW_TRANSPARENT_FRAMEBUFFER));
            assert(native.styleMask == NSWindowStyleMaskBorderless);
            assert(native.contentView.subviews.count == 0);
            NSArray *buttons = panel.contentView.subviews;
            [(NSButton *)buttons[0] performClick:nil];
            assert(closeRequests == 1 && fullscreenRequests == 0);
            [(NSButton *)buttons[2] performClick:nil];
            drainEvents();
            assert(fullscreenRequests == 1 && !glfwIsFullscreen(window, 0));
            assert(native.styleMask & NSWindowStyleMaskTitled);
        }
        drainEvents();
        assert(controlsPanel() == nil);
        @autoreleasepool {
            assert(glfwToggleFullscreen(window, 0));
            drainEvents();
            assert(controlsPanel() != nil);
            glfwDestroyWindow(window);
        }
        drainEvents();
        assert(controlsPanel() == nil);
        NSApp.presentationOptions = original;
        glfwTerminate();
        puts("kitty Cocoa integration: PASS (OpenGL, transparency, close request, exit, cleanup)");
    }
}
