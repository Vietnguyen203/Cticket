import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { Card, PageHeader } from '../components/ui'
import { ARTICLES, LEGAL_BASES, TERMS_EFFECTIVE_DATE, TERMS_VERSION, type Article } from '../legal/terms'
import { REFUND_POLICIES } from '../payments/refundPolicy'

/**
 * The terms of sale ("Điều kiện giao dịch chung"), public: read before buying,
 * accepted at checkout (OrderPage), linked from the event page and the
 * organizer's refund policy choice. Laid out as a Vietnamese contract:
 * "Căn cứ" (legal bases), then numbered articles.
 */
export function TermsPage() {
  const { hash } = useLocation()

  // Links like /dieu-khoan#huy-va-hoan-tien open at that article.
  useEffect(() => {
    if (!hash) return
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' })
  }, [hash])

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader
        title="Điều kiện giao dịch chung"
        subtitle={`Hợp đồng mua vé sự kiện trên ETP Tickets · Phiên bản ${TERMS_VERSION}, hiệu lực từ ${TERMS_EFFECTIVE_DATE}`}
      />

      <Card className="space-y-3 text-sm leading-relaxed text-slate-700">
        <h2 className="font-semibold text-ink">Căn cứ pháp lý</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          {LEGAL_BASES.map((basis) => (
            <li key={basis.law}>
              <span className="font-medium text-ink">{basis.law}</span>
              {basis.articles && <>: {basis.articles}</>}
              ;
            </li>
          ))}
        </ul>
        <p>Trên cơ sở tự nguyện, bình đẳng, thiện chí và trung thực, Khách hàng mua vé trên ETP đồng ý với các điều khoản sau.</p>
      </Card>

      <nav aria-label="Mục lục" className="rounded-card border border-line bg-white p-5 text-sm shadow-card">
        <p className="mb-2 font-semibold text-ink">Mục lục</p>
        <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {ARTICLES.map((article, index) => (
            <li key={article.id}>
              <a href={`#${article.id}`} className="text-brand-700 hover:underline">
                Điều {index + 1}. {article.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-4">
        {ARTICLES.map((article, index) => (
          <ArticleCard key={article.id} article={article} number={index + 1} />
        ))}
      </div>
    </div>
  )
}

function ArticleCard({ article, number }: { article: Article; number: number }) {
  return (
    <section id={article.id} aria-labelledby={`${article.id}-title`} className="scroll-mt-24">
      <Card className="space-y-3 text-sm leading-relaxed text-slate-700">
        <h2 id={`${article.id}-title`} className="text-base font-semibold text-ink">
          Điều {number}. {article.title}
        </h2>
        <ol className="space-y-2">
          {article.clauses.map((clause, index) => (
            <li key={index} className="flex gap-2">
              <span className="shrink-0 font-medium text-slate-500">{index + 1}.</span>
              <span>{clause}</span>
            </li>
          ))}
        </ol>
        {article.extra === 'refund-tiers' && <RefundTiers />}
      </Card>
    </section>
  )
}

/** The three policies an organizer can choose, from the same data as the event page. */
function RefundTiers() {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-sm">
        <caption className="sr-only">Các mức hoàn tiền khi Khách hàng tự hủy đơn</caption>
        <thead>
          <tr className="border-b border-line text-slate-500">
            <th scope="col" className="py-2 pr-4 font-medium">
              Chính sách
            </th>
            <th scope="col" className="py-2 font-medium">
              Hủy trước giờ diễn
            </th>
          </tr>
        </thead>
        <tbody>
          {REFUND_POLICIES.map((policy) => (
            <tr key={policy.value} className="border-b border-line align-top last:border-0">
              <th scope="row" className="py-2 pr-4 font-semibold text-ink">
                {policy.label}
              </th>
              <td className="py-2">
                {policy.tiers.length === 0 ? (
                  'Khách hàng không tự hủy đơn được.'
                ) : (
                  <ul className="space-y-0.5">
                    {policy.tiers.map((tier) => (
                      <li key={tier.before}>
                        Từ {tier.before} trở lên: hoàn {tier.percent}%
                      </li>
                    ))}
                    <li className="text-slate-500">Sau mốc cuối: không hủy được</li>
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
