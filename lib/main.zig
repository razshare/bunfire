const std = @import("std");
const fmt = std.fmt;

var counter: u32 = 0;

pub export fn message() [*]const u8 {
    const str = fmt.allocPrint(std.heap.page_allocator, "rendering counter is {d}", .{counter}) catch "error";

    const slice: [*]const u8 = str.ptr;

    counter += 1;

    return slice;
}
