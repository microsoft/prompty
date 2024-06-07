export default function Page({ params }: { params: { slug?: string[] } }) {
  return (<div>
    <div>HERE</div>
    {params.slug && <div>{params.slug.join('/')}</div>}
  </div>);
}
