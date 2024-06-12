interface NavigationItem {
  title: string;
  href: string;
}

export const navigation: NavigationItem[] = [
  {
    title: "Documentation",
    href: "/docs",
  },
  /*
  {
    title: "Blog",
    href: "/blog",
  }*/
];

export interface Index {
  path: string;
  document?: IDocument;
  children: Index[];
}

export interface IDocument {
  title: string;
  index: number;
  tags: string[];
  authors: string[];
  description: string;
  images: string[];
  date: string;
  [key: string]: unknown;
}