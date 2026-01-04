import type { Env } from "./types";

export type SearchResult = {
  title: string;
  snippet: string;
  url: string;
};

export type SearchProvider = {
  search: (query: string) => Promise<SearchResult[]>;
};

class NoopSearchProvider implements SearchProvider {
  async search(): Promise<SearchResult[]> {
    return [];
  }
}

export function getSearchProvider(_env: Env): SearchProvider {
  return new NoopSearchProvider();
}

export function formatSearchResults(results: SearchResult[]): string[] {
  return results.map((item, index) => `${index + 1}. ${item.title}\n${item.snippet}\n${item.url}`);
}
