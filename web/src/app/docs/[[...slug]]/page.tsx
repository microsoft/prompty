import Block from "@/components/block";
import Footer from "@/components/nav/footer";
import Header from "@/components/nav/header";

export default function Page({ params }: { params: { slug?: string[] } }) {
  return (
    <>
      <Header innerClassName="h-12 flex flex-row center items-center gap-3">
        <div>My thing</div>
      </Header>
      <Block>
        <div>
          <div>HERE</div>
          {params.slug && <div>{params.slug.join("/")}</div>}
        </div>
      </Block>
      <Footer
        outerClassName="mt-8 mb-8"
        innerClassName="border-t-[1px] border-zinc-300 dark:border-zinc-700"
      >
        <div>My thing</div>
      </Footer>
    </>
  );
}
