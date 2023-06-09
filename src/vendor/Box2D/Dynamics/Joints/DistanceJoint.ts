/*
 * Copyright (c) 2006-2007 Erin Catto http://www.box2d.org
 *
 * This software is provided 'as-is', without any express or implied
 * warranty.  In no event will the authors be held liable for any damages
 * arising from the use of this software.
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 * 1. The origin of this software must not be misrepresented; you must not
 * claim that you wrote the original software. If you use this software
 * in a product, an acknowledgment in the product documentation would be
 * appreciated but is not required.
 * 2. Altered source versions must be plainly marked as such, and must not be
 * misrepresented as being the original software.
 * 3. This notice may not be removed or altered from any source distribution.
 */

import { Abs, Clamp, Rot, Vec2, XY } from '../../Common/Math'
import {
  linearSlop,
  maxLinearCorrection,
  Maybe,
  pi
} from '../../Common/Settings'
import { Body } from '../Body'
import { SolverData } from '../TimeStep'

import { IJointDef, Joint, JointDef, JointType } from './Joint'

export interface IDistanceJointDef extends IJointDef {
  localAnchorA: XY
  localAnchorB: XY
  length: number
  frequencyHz?: number
  dampingRatio?: number
}

/// Distance joint definition. This requires defining an
/// anchor point on both bodies and the non-zero length of the
/// distance joint. The definition uses local anchor points
/// so that the initial configuration can violate the constraint
/// slightly. This helps when saving and loading a game.
/// @warning Do not use a zero or short length.
export class DistanceJointDef extends JointDef implements IDistanceJointDef {
  readonly localAnchorA: Vec2 = new Vec2()
  readonly localAnchorB: Vec2 = new Vec2()
  length = 1
  frequencyHz = 0
  dampingRatio = 0

  constructor() {
    super(JointType.e_distanceJoint)
  }

  Initialize(b1: Body, b2: Body, anchor1: XY, anchor2: XY): void {
    this.bodyA = b1
    this.bodyB = b2
    this.bodyA.GetLocalPoint(anchor1, this.localAnchorA)
    this.bodyB.GetLocalPoint(anchor2, this.localAnchorB)
    this.length = Vec2.DistanceVV(anchor1, anchor2)
    this.frequencyHz = 0
    this.dampingRatio = 0
  }
}

export class DistanceJoint extends Joint {
  private static InitVelocityConstraints_s_P = new Vec2()

  private static SolveVelocityConstraints_s_vpA = new Vec2()
  private static SolveVelocityConstraints_s_vpB = new Vec2()
  private static SolveVelocityConstraints_s_P = new Vec2()

  private static SolvePositionConstraints_s_P = new Vec2()
  m_frequencyHz = 0
  m_dampingRatio = 0
  m_bias = 0

  // Solver shared
  readonly m_localAnchorA: Vec2 = new Vec2()
  readonly m_localAnchorB: Vec2 = new Vec2()
  m_gamma = 0
  m_impulse = 0
  m_length = 0

  // Solver temp
  m_indexA = 0
  m_indexB = 0
  readonly m_u: Vec2 = new Vec2()
  readonly m_rA: Vec2 = new Vec2()
  readonly m_rB: Vec2 = new Vec2()
  readonly m_localCenterA: Vec2 = new Vec2()
  readonly m_localCenterB: Vec2 = new Vec2()
  m_invMassA = 0
  m_invMassB = 0
  m_invIA = 0
  m_invIB = 0
  m_mass = 0

  readonly m_qA: Rot = new Rot()
  readonly m_qB: Rot = new Rot()
  readonly m_lalcA: Vec2 = new Vec2()
  readonly m_lalcB: Vec2 = new Vec2()

  constructor(def: IDistanceJointDef) {
    super(def)

    this.m_frequencyHz = Maybe(def.frequencyHz, 0)
    this.m_dampingRatio = Maybe(def.dampingRatio, 0)

    this.m_localAnchorA.Copy(def.localAnchorA)
    this.m_localAnchorB.Copy(def.localAnchorB)
    this.m_length = def.length
  }

  GetAnchorA<T extends XY>(out: T): T {
    return this.m_bodyA.GetWorldPoint(this.m_localAnchorA, out)
  }

  GetAnchorB<T extends XY>(out: T): T {
    return this.m_bodyB.GetWorldPoint(this.m_localAnchorB, out)
  }

  GetReactionForce<T extends XY>(inv_dt: number, out: T): T {
    out.x = inv_dt * this.m_impulse * this.m_u.x
    out.y = inv_dt * this.m_impulse * this.m_u.y
    return out
  }

  GetReactionTorque(inv_dt: number): number {
    return 0
  }

  GetLocalAnchorA(): Readonly<Vec2> {
    return this.m_localAnchorA
  }

  GetLocalAnchorB(): Readonly<Vec2> {
    return this.m_localAnchorB
  }

  SetLength(length: number): void {
    this.m_length = length
  }

  Length() {
    return this.m_length
  }

  SetFrequency(hz: number): void {
    this.m_frequencyHz = hz
  }

  GetFrequency() {
    return this.m_frequencyHz
  }

  SetDampingRatio(ratio: number): void {
    this.m_dampingRatio = ratio
  }

  GetDampingRatio() {
    return this.m_dampingRatio
  }

  Dump(log: (format: string, ...args: any[]) => void) {
    const indexA: number = this.m_bodyA.m_islandIndex
    const indexB: number = this.m_bodyB.m_islandIndex

    log('  const jd: DistanceJointDef = new DistanceJointDef();\n')
    log('  jd.bodyA = bodies[%d];\n', indexA)
    log('  jd.bodyB = bodies[%d];\n', indexB)
    log(
      '  jd.collideConnected = %s;\n',
      this.m_collideConnected ? 'true' : 'false'
    )
    log(
      '  jd.localAnchorA.Set(%.15f, %.15f);\n',
      this.m_localAnchorA.x,
      this.m_localAnchorA.y
    )
    log(
      '  jd.localAnchorB.Set(%.15f, %.15f);\n',
      this.m_localAnchorB.x,
      this.m_localAnchorB.y
    )
    log('  jd.length = %.15f;\n', this.m_length)
    log('  jd.frequencyHz = %.15f;\n', this.m_frequencyHz)
    log('  jd.dampingRatio = %.15f;\n', this.m_dampingRatio)
    log('  joints[%d] = this.m_world.CreateJoint(jd);\n', this.m_index)
  }
  InitVelocityConstraints(data: SolverData): void {
    this.m_indexA = this.m_bodyA.m_islandIndex
    this.m_indexB = this.m_bodyB.m_islandIndex
    this.m_localCenterA.Copy(this.m_bodyA.m_sweep.localCenter)
    this.m_localCenterB.Copy(this.m_bodyB.m_sweep.localCenter)
    this.m_invMassA = this.m_bodyA.m_invMass
    this.m_invMassB = this.m_bodyB.m_invMass
    this.m_invIA = this.m_bodyA.m_invI
    this.m_invIB = this.m_bodyB.m_invI

    const cA: Vec2 = data.positions[this.m_indexA].c
    const aA: number = data.positions[this.m_indexA].a
    const vA: Vec2 = data.velocities[this.m_indexA].v
    let wA: number = data.velocities[this.m_indexA].w

    const cB: Vec2 = data.positions[this.m_indexB].c
    const aB: number = data.positions[this.m_indexB].a
    const vB: Vec2 = data.velocities[this.m_indexB].v
    let wB: number = data.velocities[this.m_indexB].w

    // const qA: Rot = new Rot(aA), qB: Rot = new Rot(aB);
    const qA: Rot = this.m_qA.SetAngle(aA)
    const qB: Rot = this.m_qB.SetAngle(aB)

    // m_rA = Mul(qA, m_localAnchorA - m_localCenterA);
    Vec2.SubVV(this.m_localAnchorA, this.m_localCenterA, this.m_lalcA)
    Rot.MulRV(qA, this.m_lalcA, this.m_rA)
    // m_rB = Mul(qB, m_localAnchorB - m_localCenterB);
    Vec2.SubVV(this.m_localAnchorB, this.m_localCenterB, this.m_lalcB)
    Rot.MulRV(qB, this.m_lalcB, this.m_rB)
    // m_u = cB + m_rB - cA - m_rA;
    this.m_u.x = cB.x + this.m_rB.x - cA.x - this.m_rA.x
    this.m_u.y = cB.y + this.m_rB.y - cA.y - this.m_rA.y

    // Handle singularity.
    const length: number = this.m_u.Length()
    if (length > linearSlop) {
      this.m_u.SelfMul(1 / length)
    } else {
      this.m_u.SetZero()
    }

    // float32 crAu = Cross(m_rA, m_u);
    const crAu: number = Vec2.CrossVV(this.m_rA, this.m_u)
    // float32 crBu = Cross(m_rB, m_u);
    const crBu: number = Vec2.CrossVV(this.m_rB, this.m_u)
    // float32 invMass = m_invMassA + m_invIA * crAu * crAu + m_invMassB + m_invIB * crBu * crBu;
    let invMass: number =
      this.m_invMassA +
      this.m_invIA * crAu * crAu +
      this.m_invMassB +
      this.m_invIB * crBu * crBu

    // Compute the effective mass matrix.
    this.m_mass = invMass !== 0 ? 1 / invMass : 0

    if (this.m_frequencyHz > 0) {
      const C: number = length - this.m_length

      // Frequency
      const omega: number = 2 * pi * this.m_frequencyHz

      // Damping coefficient
      const d: number = 2 * this.m_mass * this.m_dampingRatio * omega

      // Spring stiffness
      const k: number = this.m_mass * omega * omega

      // magic formulas
      const h: number = data.step.dt
      this.m_gamma = h * (d + h * k)
      this.m_gamma = this.m_gamma !== 0 ? 1 / this.m_gamma : 0
      this.m_bias = C * h * k * this.m_gamma

      invMass += this.m_gamma
      this.m_mass = invMass !== 0 ? 1 / invMass : 0
    } else {
      this.m_gamma = 0
      this.m_bias = 0
    }

    if (data.step.warmStarting) {
      // Scale the impulse to support a variable time step.
      this.m_impulse *= data.step.dtRatio

      // Vec2 P = m_impulse * m_u;
      const P: Vec2 = Vec2.MulSV(
        this.m_impulse,
        this.m_u,
        DistanceJoint.InitVelocityConstraints_s_P
      )

      // vA -= m_invMassA * P;
      vA.SelfMulSub(this.m_invMassA, P)
      // wA -= m_invIA * Cross(m_rA, P);
      wA -= this.m_invIA * Vec2.CrossVV(this.m_rA, P)
      // vB += m_invMassB * P;
      vB.SelfMulAdd(this.m_invMassB, P)
      // wB += m_invIB * Cross(m_rB, P);
      wB += this.m_invIB * Vec2.CrossVV(this.m_rB, P)
    } else {
      this.m_impulse = 0
    }

    // data.velocities[this.m_indexA].v = vA;
    data.velocities[this.m_indexA].w = wA
    // data.velocities[this.m_indexB].v = vB;
    data.velocities[this.m_indexB].w = wB
  }
  SolveVelocityConstraints(data: SolverData): void {
    const vA: Vec2 = data.velocities[this.m_indexA].v
    let wA: number = data.velocities[this.m_indexA].w
    const vB: Vec2 = data.velocities[this.m_indexB].v
    let wB: number = data.velocities[this.m_indexB].w

    // Vec2 vpA = vA + Cross(wA, m_rA);
    const vpA: Vec2 = Vec2.AddVCrossSV(
      vA,
      wA,
      this.m_rA,
      DistanceJoint.SolveVelocityConstraints_s_vpA
    )
    // Vec2 vpB = vB + Cross(wB, m_rB);
    const vpB: Vec2 = Vec2.AddVCrossSV(
      vB,
      wB,
      this.m_rB,
      DistanceJoint.SolveVelocityConstraints_s_vpB
    )
    // float32 Cdot = Dot(m_u, vpB - vpA);
    const Cdot: number = Vec2.DotVV(this.m_u, Vec2.SubVV(vpB, vpA, Vec2.s_t0))

    const impulse: number =
      -this.m_mass * (Cdot + this.m_bias + this.m_gamma * this.m_impulse)
    this.m_impulse += impulse

    // Vec2 P = impulse * m_u;
    const P: Vec2 = Vec2.MulSV(
      impulse,
      this.m_u,
      DistanceJoint.SolveVelocityConstraints_s_P
    )

    // vA -= m_invMassA * P;
    vA.SelfMulSub(this.m_invMassA, P)
    // wA -= m_invIA * Cross(m_rA, P);
    wA -= this.m_invIA * Vec2.CrossVV(this.m_rA, P)
    // vB += m_invMassB * P;
    vB.SelfMulAdd(this.m_invMassB, P)
    // wB += m_invIB * Cross(m_rB, P);
    wB += this.m_invIB * Vec2.CrossVV(this.m_rB, P)

    // data.velocities[this.m_indexA].v = vA;
    data.velocities[this.m_indexA].w = wA
    // data.velocities[this.m_indexB].v = vB;
    data.velocities[this.m_indexB].w = wB
  }
  SolvePositionConstraints(data: SolverData): boolean {
    if (this.m_frequencyHz > 0) {
      // There is no position correction for soft distance constraints.
      return true
    }

    const cA: Vec2 = data.positions[this.m_indexA].c
    let aA: number = data.positions[this.m_indexA].a
    const cB: Vec2 = data.positions[this.m_indexB].c
    let aB: number = data.positions[this.m_indexB].a

    // const qA: Rot = new Rot(aA), qB: Rot = new Rot(aB);
    const qA: Rot = this.m_qA.SetAngle(aA)
    const qB: Rot = this.m_qB.SetAngle(aB)

    // Vec2 rA = Mul(qA, m_localAnchorA - m_localCenterA);
    const rA: Vec2 = Rot.MulRV(qA, this.m_lalcA, this.m_rA) // use m_rA
    // Vec2 rB = Mul(qB, m_localAnchorB - m_localCenterB);
    const rB: Vec2 = Rot.MulRV(qB, this.m_lalcB, this.m_rB) // use m_rB
    // Vec2 u = cB + rB - cA - rA;
    const u: Vec2 = this.m_u // use m_u
    u.x = cB.x + rB.x - cA.x - rA.x
    u.y = cB.y + rB.y - cA.y - rA.y

    // float32 length = u.Normalize();
    const length: number = this.m_u.Normalize()
    // float32 C = length - m_length;
    let C: number = length - this.m_length
    C = Clamp(C, -maxLinearCorrection, maxLinearCorrection)

    const impulse: number = -this.m_mass * C
    // Vec2 P = impulse * u;
    const P: Vec2 = Vec2.MulSV(
      impulse,
      u,
      DistanceJoint.SolvePositionConstraints_s_P
    )

    // cA -= m_invMassA * P;
    cA.SelfMulSub(this.m_invMassA, P)
    // aA -= m_invIA * Cross(rA, P);
    aA -= this.m_invIA * Vec2.CrossVV(rA, P)
    // cB += m_invMassB * P;
    cB.SelfMulAdd(this.m_invMassB, P)
    // aB += m_invIB * Cross(rB, P);
    aB += this.m_invIB * Vec2.CrossVV(rB, P)

    // data.positions[this.m_indexA].c = cA;
    data.positions[this.m_indexA].a = aA
    // data.positions[this.m_indexB].c = cB;
    data.positions[this.m_indexB].a = aB

    return Abs(C) < linearSlop
  }
}
