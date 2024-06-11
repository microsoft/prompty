interface NavigationItem {
  title: string;
  href: string;
}

export const navigation: NavigationItem[] = [
  /*
  {
    title: "Docs",
    href: "/docs",
  }
  
  {
    title: "Blog",
    href: "/blog",
  }*/
];


export interface IDocument {
  title: string;
  tags: string[];
  authors: string[];
  description: string;
  images: string[];
  date: string;
  [key: string]: unknown;
}