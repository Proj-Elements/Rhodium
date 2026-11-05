import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsDataBoundary } from "@/components/settings-data-boundary";

describe("settings failed-load boundary", () => {
  it("renders a persistent retry instead of an empty writable ledger when loading fails", () => {
    const markup = renderToStaticMarkup(
      <SettingsDataBoundary error="无法读取设置" onRetry={() => {}}>
        <p>当前预设：未设置</p><button>设置预算</button><button>添加分类</button>
      </SettingsDataBoundary>,
    );
    expect(markup).toContain("无法读取设置");
    expect(markup).toContain("重新加载");
    expect(markup).not.toContain("未设置");
    expect(markup).not.toContain("设置预算");
    expect(markup).not.toContain("添加分类");
  });

  it("renders the actual content after a successful retry, including legitimately unset values", () => {
    const markup = renderToStaticMarkup(<SettingsDataBoundary error="" onRetry={() => {}}><p>当前预设：未设置</p></SettingsDataBoundary>);
    expect(markup).toContain("当前预设：未设置");
    expect(markup).not.toContain("重新加载");
  });
});
