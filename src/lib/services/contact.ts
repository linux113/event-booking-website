import { buildSiteContact, EMPTY_CONTACT, type SiteContact } from "@/lib/contact";
import { getFeaturedEvent } from "@/lib/services/events";

/**
 * The contact details the site chrome needs, read from the database.
 *
 * The root layout calls this once per render and hands the result to the header and the
 * footer, so the WhatsApp link in the navigation and the phone number in the footer are
 * the same row rather than two independent reads.
 *
 * **A failed or missing read returns an empty contact, not an error.** The header and
 * footer are chrome: a deployment without credentials (or a database that is briefly
 * unreachable) should render the site with fewer links, not fail to render the page the
 * visitor asked for. Pages that *are* about the contact details — `/contact` — call
 * `getFeaturedEvent()` themselves and show an honest error state, because there the
 * absence is the answer.
 */
export async function getSiteContact(): Promise<SiteContact> {
  const result = await getFeaturedEvent();

  if (!result.ok || result.data === null) {
    return EMPTY_CONTACT;
  }

  return buildSiteContact(result.data);
}
