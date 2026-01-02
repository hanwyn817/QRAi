import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

const TIERS = [
  {
    name: "Free",
    price: "¥0 / 月",
    highlight: "适合试用",
    features: ["基础模型访问", "每月有限评估次数", "基础模板库"]
  },
  {
    name: "Pro",
    price: "¥199 / 月",
    highlight: "适合小团队",
    features: ["更丰富模型访问", "更高评估配额", "模板与报告高级管理"]
  },
  {
    name: "Max",
    price: "¥499 / 月",
    highlight: "适合企业",
    features: ["全量模型访问", "更高并发与配额", "专属支持与审计"]
  }
];

export default function Pricing() {
  const [tierModels, setTierModels] = useState<{ free: string[]; pro: string[]; max: string[] } | null>(null);

  useEffect(() => {
    api.listModelTiers().then((result) => {
      if (result.data) {
        setTierModels(result.data.tiers);
      }
    });
  }, []);

  const modelScopes = useMemo(() => {
    const free = tierModels?.free ?? [];
    const pro = tierModels?.pro ?? [];
    const max = tierModels?.max ?? [];
    const freeSet = new Set(free);
    const proSet = new Set(pro);
    const proExclusive = pro.filter((name) => !freeSet.has(name));
    const maxExclusive = max.filter((name) => !proSet.has(name));

    const formatList = (items: string[]) => (items.length > 0 ? items : ["暂无"]);
    const freeLines = ["基础模型", ...formatList(free)];
    const proLines = ["所有基础模型", "Pro专属模型：", ...formatList(proExclusive)];
    const maxLines = ["所有Pro模型", "Max专属模型：", ...formatList(maxExclusive)];

    return { freeLines, proLines, maxLines };
  }, [tierModels]);

  return (
    <div className="pricing-page">
      <header className="pricing-header">
        <div>
          <h2>价格与权益</h2>
          <p className="muted">选择适合你的等级，按需升级。</p>
        </div>
      </header>
      <div className="pricing-grid">
        {TIERS.map((tier) => (
          <section key={tier.name} className="card pricing-card">
            <div className="pricing-title">
              <h3>{tier.name}</h3>
              <span className="muted">{tier.highlight}</span>
            </div>
            <div className="pricing-price">{tier.price}</div>
            <ul className="pricing-features">
              {tier.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <button className="pricing-cta">订阅 {tier.name}</button>
          </section>
        ))}
      </div>
      <section className="card pricing-compare">
        <div className="section-header">
          <h3>等级对比</h3>
        </div>
        <div className="compare-grid">
          <div className="compare-row header">
            <span>权益</span>
            <span>Free</span>
            <span>Pro</span>
            <span>Max</span>
          </div>
          <div className="compare-row">
            <span>模型可用范围</span>
            <span className="compare-lines">
              {modelScopes.freeLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
            <span className="compare-lines">
              {modelScopes.proLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
            <span className="compare-lines">
              {modelScopes.maxLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
          </div>
          <div className="compare-row">
            <span>评估配额</span>
            <span>低</span>
            <span>中</span>
            <span>高</span>
          </div>
          <div className="compare-row">
            <span>团队协作</span>
            <span>基础</span>
            <span>标准</span>
            <span>高级</span>
          </div>
          <div className="compare-row">
            <span>支持与审计</span>
            <span>无</span>
            <span>标准</span>
            <span>专属</span>
          </div>
        </div>
      </section>
    </div>
  );
}
