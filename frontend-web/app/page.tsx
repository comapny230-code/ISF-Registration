import Link from "next/link";
import Image from "next/image";
import { getFeatureFlags } from "@/lib/config";

export default function Home() {
  const { bookingUi } = getFeatureFlags();
  const showBooking = bookingUi || process.env.NODE_ENV !== "production";

  return (
    <section className="hero">
      <div className="hero-emblem">
        <Image src="/logos/udbhav.png" alt="ISF" width={80} height={80} style={{ borderRadius: 12, objectFit: "contain" }} priority />
      </div>

      <span className="eyebrow-badge">GIET University · Gunupur, Odisha</span>

      <h1>ISF · Startup Jathara</h1>

      <div className="pills-row">
        <span className="pill-item">18–20 December 2026 (Pre-event 17 Dec)</span>
        <span className="pill-item">GIET University, Gunupur</span>
        <span className="pill-item">ISF & Incubatex Innovation</span>
      </div>

      <p className="lede">
        The premier Dandakaranya Innovation Summit bringing together startup leaders and student innovators for pitch stages, roundtables, and ecosystem growth.
      </p>

      <div className="actions">
        <Link href="/register" className="btn btn-primary btn-large">
          Summit Registration →
        </Link>
        {showBooking && (
          <Link href="/book-your-stall" className="btn btn-forest btn-large">
            Book Your Stall →
          </Link>
        )}
      </div>

      <div className="tracks-ribbon">
        <p className="tracks-ribbon-title">Open Registration Tracks</p>
        <div className="tracks-badges">
          <span className="track-chip">Senior Track · Ages 18–25</span>
          <span className="track-chip">Junior Track · Ages 8–17</span>
        </div>
      </div>
    </section>
  );
}
