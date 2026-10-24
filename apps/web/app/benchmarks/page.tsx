import type { Metadata } from "next";
import { connection } from "next/server";
import { BenchmarkDashboard } from "@/components/benchmarks/benchmark-dashboard";
import { aggregateBenchmarks } from "@/lib/benchmarks/aggregate";

export const metadata: Metadata = {
  title: "Benchmark Dashboard | PatchVerdict",
  description:
    "Inspect recorded candidate repairs, checks, and verdicts from selected controlled scenarios, with clear evidence availability and benchmark limits.",
};

export const runtime = "nodejs";

export default async function BenchmarksPage() {
  // Read the current saved artifacts for each request, never at build time.
  await connection();
  const data = await aggregateBenchmarks();
  return <BenchmarkDashboard data={data} />;
}
