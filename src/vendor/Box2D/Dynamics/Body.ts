/*
 * Copyright (c) 2006-2011 Erin Catto http://www.box2d.org
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

// DEBUG: import { Assert } from "../Common/Settings";
// DEBUG: import { IsValid } from "../Common/Math";
import { MassData, Shape } from '../Collision/Shapes/Shape'
import { Rot, Sweep, Transform, Vec2, XY } from '../Common/Math'
import { Maybe } from '../Common/Settings'
// #if ENABLE_CONTROLLER
import { ControllerEdge } from '../Controllers/Controller'

import { ContactEdge } from './Contacts/Contact'
import { Fixture, FixtureDef, IFixtureDef } from './Fixture'
import { JointEdge } from './Joints/Joint'
import { World } from './World'
// #endif

/// The body type.
/// static: zero mass, zero velocity, may be manually moved
/// kinematic: zero mass, non-zero velocity set by user, moved by solver
/// dynamic: positive mass, non-zero velocity determined by forces, moved by solver
export enum BodyType {
  unknown = -1,
  staticBody = 0,
  kinematicBody = 1,
  dynamicBody = 2

  // TODO_ERIN
  // bulletBody = 3
}

export interface IBodyDef {
  /// The body type: static, kinematic, or dynamic.
  /// Note: if a dynamic body would have zero mass, the mass is set to one.
  type?: BodyType

  /// The world position of the body. Avoid creating bodies at the origin
  /// since this can lead to many overlapping shapes.
  position?: XY

  /// The world angle of the body in radians.
  angle?: number

  /// The linear velocity of the body's origin in world co-ordinates.
  linearVelocity?: XY

  /// The angular velocity of the body.
  angularVelocity?: number

  /// Linear damping is use to reduce the linear velocity. The damping parameter
  /// can be larger than 1.0f but the damping effect becomes sensitive to the
  /// time step when the damping parameter is large.
  /// Units are 1/time
  linearDamping?: number

  /// Angular damping is use to reduce the angular velocity. The damping parameter
  /// can be larger than 1.0f but the damping effect becomes sensitive to the
  /// time step when the damping parameter is large.
  /// Units are 1/time
  angularDamping?: number

  /// Set this flag to false if this body should never fall asleep. Note that
  /// this increases CPU usage.
  allowSleep?: boolean

  /// Is this body initially awake or sleeping?
  awake?: boolean

  /// Should this body be prevented from rotating? Useful for characters.
  fixedRotation?: boolean

  /// Is this a fast moving body that should be prevented from tunneling through
  /// other moving bodies? Note that all bodies are prevented from tunneling through
  /// kinematic and static bodies. This setting is only considered on dynamic bodies.
  /// @warning You should use this flag sparingly since it increases processing time.
  bullet?: boolean

  /// Does this body start out active?
  active?: boolean

  /// Use this to store application specific body data.
  userData?: any

  /// Scale the gravity applied to this body.
  gravityScale?: number
}

/// A body definition holds all the data needed to construct a rigid body.
/// You can safely re-use body definitions. Shapes are added to a body after construction.
export class BodyDef implements IBodyDef {
  /// The body type: static, kinematic, or dynamic.
  /// Note: if a dynamic body would have zero mass, the mass is set to one.
  type: BodyType = BodyType.staticBody

  /// The world position of the body. Avoid creating bodies at the origin
  /// since this can lead to many overlapping shapes.
  readonly position: Vec2 = new Vec2(0, 0)

  /// The world angle of the body in radians.
  angle = 0

  /// The linear velocity of the body's origin in world co-ordinates.
  readonly linearVelocity: Vec2 = new Vec2(0, 0)

  /// The angular velocity of the body.
  angularVelocity = 0

  /// Linear damping is use to reduce the linear velocity. The damping parameter
  /// can be larger than 1.0f but the damping effect becomes sensitive to the
  /// time step when the damping parameter is large.
  linearDamping = 0

  /// Angular damping is use to reduce the angular velocity. The damping parameter
  /// can be larger than 1.0f but the damping effect becomes sensitive to the
  /// time step when the damping parameter is large.
  angularDamping = 0

  /// Set this flag to false if this body should never fall asleep. Note that
  /// this increases CPU usage.
  allowSleep = true

  /// Is this body initially awake or sleeping?
  awake = true

  /// Should this body be prevented from rotating? Useful for characters.
  fixedRotation = false

  /// Is this a fast moving body that should be prevented from tunneling through
  /// other moving bodies? Note that all bodies are prevented from tunneling through
  /// kinematic and static bodies. This setting is only considered on dynamic bodies.
  /// @warning You should use this flag sparingly since it increases processing time.
  bullet = false

  /// Does this body start out active?
  active = true

  /// Use this to store application specific body data.
  userData: any = null

  /// Scale the gravity applied to this body.
  gravityScale = 1
}

/// A rigid body. These are created via World::CreateBody.
export class Body {
  /// Creates a fixture from a shape and attach it to this body.
  /// This is a convenience function. Use FixtureDef if you need to set parameters
  /// like friction, restitution, user data, or filtering.
  /// If the density is non-zero, this function automatically updates the mass of the body.
  /// @param shape the shape to be cloned.
  /// @param density the shape density (set to zero for static bodies).
  /// @warning This function is locked during callbacks.
  private static CreateFixtureShapeDensity_s_def: FixtureDef = new FixtureDef()

  /// Set the mass properties to override the mass properties of the fixtures.
  /// Note that this changes the center of mass position.
  /// Note that creating or destroying fixtures can also alter the mass.
  /// This function has no effect if the body isn't dynamic.
  /// @param massData the mass properties.
  private static SetMassData_s_oldCenter: Vec2 = new Vec2()

  /// This resets the mass properties to the sum of the mass properties of the fixtures.
  /// This normally does not need to be called unless you called SetMassData to override
  /// the mass and you later want to reset the mass.
  private static ResetMassData_s_localCenter: Vec2 = new Vec2()
  private static ResetMassData_s_oldCenter: Vec2 = new Vec2()
  private static ResetMassData_s_massData: MassData = new MassData()

  private static SynchronizeFixtures_s_xf1: Transform = new Transform()
  m_type: BodyType = BodyType.staticBody

  m_islandFlag = false
  m_awakeFlag = false
  m_autoSleepFlag = false
  m_bulletFlag = false
  m_fixedRotationFlag = false
  m_activeFlag = false
  m_toiFlag = false

  m_islandIndex = 0

  readonly m_xf: Transform = new Transform() // the body origin transform
  // #if ENABLE_PARTICLE
  readonly m_xf0: Transform = new Transform()
  // #endif
  readonly m_sweep: Sweep = new Sweep() // the swept motion for CCD

  readonly m_linearVelocity: Vec2 = new Vec2()
  m_angularVelocity = 0

  readonly m_force: Vec2 = new Vec2()
  m_torque = 0

  m_world: World
  m_prev: Body | null = null
  m_next: Body | null = null

  m_fixtureList: Fixture | null = null
  m_fixtureCount = 0

  m_jointList: JointEdge | null = null
  m_contactList: ContactEdge | null = null

  m_mass = 1
  m_invMass = 1

  // Rotational inertia about the center of mass.
  m_I = 0
  m_invI = 0

  m_linearDamping = 0
  m_angularDamping = 0
  m_gravityScale = 1

  m_sleepTime = 0

  m_userData: any = null

  // #if ENABLE_CONTROLLER
  m_controllerList: ControllerEdge | null = null
  m_controllerCount = 0
  // #endif

  constructor(bd: IBodyDef, world: World) {
    this.m_bulletFlag = Maybe(bd.bullet, false)
    this.m_fixedRotationFlag = Maybe(bd.fixedRotation, false)
    this.m_autoSleepFlag = Maybe(bd.allowSleep, true)
    this.m_awakeFlag = Maybe(bd.awake, true)
    this.m_activeFlag = Maybe(bd.active, true)

    this.m_world = world

    this.m_xf.p.Copy(Maybe(bd.position, Vec2.ZERO))
    // DEBUG: Assert(this.m_xf.p.IsValid());
    this.m_xf.q.SetAngle(Maybe(bd.angle, 0))
    // DEBUG: Assert(IsValid(this.m_xf.q.GetAngle()));
    // #if ENABLE_PARTICLE
    this.m_xf0.Copy(this.m_xf)
    // #endif

    this.m_sweep.localCenter.SetZero()
    this.m_sweep.c0.Copy(this.m_xf.p)
    this.m_sweep.c.Copy(this.m_xf.p)
    this.m_sweep.a0 = this.m_sweep.a = this.m_xf.q.GetAngle()
    this.m_sweep.alpha0 = 0

    this.m_linearVelocity.Copy(Maybe(bd.linearVelocity, Vec2.ZERO))
    // DEBUG: Assert(this.m_linearVelocity.IsValid());
    this.m_angularVelocity = Maybe(bd.angularVelocity, 0)
    // DEBUG: Assert(IsValid(this.m_angularVelocity));

    this.m_linearDamping = Maybe(bd.linearDamping, 0)
    this.m_angularDamping = Maybe(bd.angularDamping, 0)
    this.m_gravityScale = Maybe(bd.gravityScale, 1)
    // DEBUG: Assert(IsValid(this.m_gravityScale) && this.m_gravityScale >= 0);
    // DEBUG: Assert(IsValid(this.m_angularDamping) && this.m_angularDamping >= 0);
    // DEBUG: Assert(IsValid(this.m_linearDamping) && this.m_linearDamping >= 0);

    this.m_force.SetZero()
    this.m_torque = 0

    this.m_sleepTime = 0

    this.m_type = Maybe(bd.type, BodyType.staticBody)

    if (bd.type === BodyType.dynamicBody) {
      this.m_mass = 1
      this.m_invMass = 1
    } else {
      this.m_mass = 0
      this.m_invMass = 0
    }

    this.m_I = 0
    this.m_invI = 0

    this.m_userData = bd.userData

    this.m_fixtureList = null
    this.m_fixtureCount = 0

    // #if ENABLE_CONTROLLER
    this.m_controllerList = null
    this.m_controllerCount = 0
    // #endif
  }

  CreateFixture(a: IFixtureDef | Shape, b = 0): Fixture {
    if (a instanceof Shape) {
      return this.CreateFixtureShapeDensity(a, b)
    } else {
      return this.CreateFixtureDef(a)
    }
  }

  /// Creates a fixture and attach it to this body. Use this function if you need
  /// to set some fixture parameters, like friction. Otherwise you can create the
  /// fixture directly from a shape.
  /// If the density is non-zero, this function automatically updates the mass of the body.
  /// Contacts are not created until the next time step.
  /// @param def the fixture definition.
  /// @warning This function is locked during callbacks.
  CreateFixtureDef(def: IFixtureDef): Fixture {
    if (this.m_world.IsLocked()) {
      throw new Error()
    }

    const fixture: Fixture = new Fixture(def, this)
    fixture.Create(def)

    if (this.m_activeFlag) {
      fixture.CreateProxies(this.m_xf)
    }

    fixture.m_next = this.m_fixtureList
    this.m_fixtureList = fixture
    ++this.m_fixtureCount

    // fixture.m_body = this;

    // Adjust mass properties if needed.
    if (fixture.m_density > 0) {
      this.ResetMassData()
    }

    // Let the world know we have a new fixture. This will cause new contacts
    // to be created at the beginning of the next time step.
    this.m_world.m_newFixture = true

    return fixture
  }
  CreateFixtureShapeDensity(shape: Shape, density = 0): Fixture {
    const def: FixtureDef = Body.CreateFixtureShapeDensity_s_def
    def.shape = shape
    def.density = density
    return this.CreateFixtureDef(def)
  }

  /// Destroy a fixture. This removes the fixture from the broad-phase and
  /// destroys all contacts associated with this fixture. This will
  /// automatically adjust the mass of the body if the body is dynamic and the
  /// fixture has positive density.
  /// All fixtures attached to a body are implicitly destroyed when the body is destroyed.
  /// @param fixture the fixture to be removed.
  /// @warning This function is locked during callbacks.
  DestroyFixture(fixture: Fixture): void {
    if (this.m_world.IsLocked()) {
      throw new Error()
    }

    // DEBUG: Assert(fixture.m_body === this);

    // Remove the fixture from this body's singly linked list.
    // DEBUG: Assert(this.m_fixtureCount > 0);
    let node: Fixture | null = this.m_fixtureList
    let ppF: Fixture | null = null
    // DEBUG: let found: boolean = false;
    while (node !== null) {
      if (node === fixture) {
        if (ppF) {
          ppF.m_next = fixture.m_next
        } else {
          this.m_fixtureList = fixture.m_next
        }
        // DEBUG: found = true;
        break
      }

      ppF = node
      node = node.m_next
    }

    // You tried to remove a shape that is not attached to this body.
    // DEBUG: Assert(found);

    // Destroy any contacts associated with the fixture.
    let edge: ContactEdge | null = this.m_contactList
    while (edge) {
      const c = edge.contact
      edge = edge.next

      const fixtureA: Fixture = c.GetFixtureA()
      const fixtureB: Fixture = c.GetFixtureB()

      if (fixture === fixtureA || fixture === fixtureB) {
        // This destroys the contact and removes it from
        // this body's contact list.
        this.m_world.m_contactManager.Destroy(c)
      }
    }

    if (this.m_activeFlag) {
      fixture.DestroyProxies()
    }

    // fixture.m_body = null;
    fixture.m_next = null
    fixture.Destroy()

    --this.m_fixtureCount

    // Reset the mass data.
    this.ResetMassData()
  }

  /// Set the position of the body's origin and rotation.
  /// This breaks any contacts and wakes the other bodies.
  /// Manipulating a body's transform may cause non-physical behavior.
  /// @param position the world position of the body's local origin.
  /// @param angle the world rotation in radians.
  SetTransformVec(position: XY, angle: number): void {
    this.SetTransformXY(position.x, position.y, angle)
  }

  SetTransformXY(x: number, y: number, angle: number): void {
    if (this.m_world.IsLocked()) {
      throw new Error()
    }

    this.m_xf.q.SetAngle(angle)
    this.m_xf.p.Set(x, y)
    // #if ENABLE_PARTICLE
    this.m_xf0.Copy(this.m_xf)
    // #endif

    Transform.MulXV(this.m_xf, this.m_sweep.localCenter, this.m_sweep.c)
    this.m_sweep.a = angle

    this.m_sweep.c0.Copy(this.m_sweep.c)
    this.m_sweep.a0 = angle

    for (let f: Fixture | null = this.m_fixtureList; f; f = f.m_next) {
      f.Synchronize(this.m_xf, this.m_xf)
    }

    this.m_world.m_contactManager.FindNewContacts()
  }

  SetTransform(xf: Transform): void {
    this.SetTransformVec(xf.p, xf.GetAngle())
  }

  /// Get the body transform for the body's origin.
  /// @return the world transform of the body's origin.
  GetTransform(): Readonly<Transform> {
    return this.m_xf
  }

  /// Get the world body origin position.
  /// @return the world position of the body's origin.
  GetPosition(): Readonly<Vec2> {
    return this.m_xf.p
  }

  SetPosition(position: XY): void {
    this.SetTransformVec(position, this.GetAngle())
  }

  SetPositionXY(x: number, y: number): void {
    this.SetTransformXY(x, y, this.GetAngle())
  }

  /// Get the angle in radians.
  /// @return the current world rotation angle in radians.
  GetAngle(): number {
    return this.m_sweep.a
  }

  SetAngle(angle: number): void {
    this.SetTransformVec(this.GetPosition(), angle)
  }

  /// Get the world position of the center of mass.
  GetWorldCenter(): Readonly<Vec2> {
    return this.m_sweep.c
  }

  /// Get the local position of the center of mass.
  GetLocalCenter(): Readonly<Vec2> {
    return this.m_sweep.localCenter
  }

  /// Set the linear velocity of the center of mass.
  /// @param v the new linear velocity of the center of mass.
  SetLinearVelocity(v: XY): void {
    if (this.m_type === BodyType.staticBody) {
      return
    }

    if (Vec2.DotVV(v, v) > 0) {
      this.SetAwake(true)
    }

    this.m_linearVelocity.Copy(v)
  }

  /// Get the linear velocity of the center of mass.
  /// @return the linear velocity of the center of mass.
  GetLinearVelocity(): Readonly<Vec2> {
    return this.m_linearVelocity
  }

  /// Set the angular velocity.
  /// @param omega the new angular velocity in radians/second.
  SetAngularVelocity(w: number): void {
    if (this.m_type === BodyType.staticBody) {
      return
    }

    if (w * w > 0) {
      this.SetAwake(true)
    }

    this.m_angularVelocity = w
  }

  /// Get the angular velocity.
  /// @return the angular velocity in radians/second.
  GetAngularVelocity(): number {
    return this.m_angularVelocity
  }

  GetDefinition(bd: BodyDef): BodyDef {
    bd.type = this.GetType()
    bd.allowSleep = this.m_autoSleepFlag
    bd.angle = this.GetAngle()
    bd.angularDamping = this.m_angularDamping
    bd.gravityScale = this.m_gravityScale
    bd.angularVelocity = this.m_angularVelocity
    bd.fixedRotation = this.m_fixedRotationFlag
    bd.bullet = this.m_bulletFlag
    bd.awake = this.m_awakeFlag
    bd.linearDamping = this.m_linearDamping
    bd.linearVelocity.Copy(this.GetLinearVelocity())
    bd.position.Copy(this.GetPosition())
    bd.userData = this.GetUserData()
    return bd
  }

  /// Apply a force at a world point. If the force is not
  /// applied at the center of mass, it will generate a torque and
  /// affect the angular velocity. This wakes up the body.
  /// @param force the world force vector, usually in Newtons (N).
  /// @param point the world position of the point of application.
  /// @param wake also wake up the body
  ApplyForce(force: XY, point: XY, wake = true): void {
    if (this.m_type !== BodyType.dynamicBody) {
      return
    }

    if (wake && !this.m_awakeFlag) {
      this.SetAwake(true)
    }

    // Don't accumulate a force if the body is sleeping.
    if (this.m_awakeFlag) {
      this.m_force.x += force.x
      this.m_force.y += force.y
      this.m_torque +=
        (point.x - this.m_sweep.c.x) * force.y -
        (point.y - this.m_sweep.c.y) * force.x
    }
  }

  /// Apply a force to the center of mass. This wakes up the body.
  /// @param force the world force vector, usually in Newtons (N).
  /// @param wake also wake up the body
  ApplyForceToCenter(force: XY, wake = true): void {
    if (this.m_type !== BodyType.dynamicBody) {
      return
    }

    if (wake && !this.m_awakeFlag) {
      this.SetAwake(true)
    }

    // Don't accumulate a force if the body is sleeping.
    if (this.m_awakeFlag) {
      this.m_force.x += force.x
      this.m_force.y += force.y
    }
  }

  /// Apply a torque. This affects the angular velocity
  /// without affecting the linear velocity of the center of mass.
  /// @param torque about the z-axis (out of the screen), usually in N-m.
  /// @param wake also wake up the body
  ApplyTorque(torque: number, wake = true): void {
    if (this.m_type !== BodyType.dynamicBody) {
      return
    }

    if (wake && !this.m_awakeFlag) {
      this.SetAwake(true)
    }

    // Don't accumulate a force if the body is sleeping.
    if (this.m_awakeFlag) {
      this.m_torque += torque
    }
  }

  /// Apply an impulse at a point. This immediately modifies the velocity.
  /// It also modifies the angular velocity if the point of application
  /// is not at the center of mass. This wakes up the body.
  /// @param impulse the world impulse vector, usually in N-seconds or kg-m/s.
  /// @param point the world position of the point of application.
  /// @param wake also wake up the body
  ApplyLinearImpulse(impulse: XY, point: XY, wake = true): void {
    if (this.m_type !== BodyType.dynamicBody) {
      return
    }

    if (wake && !this.m_awakeFlag) {
      this.SetAwake(true)
    }

    // Don't accumulate a force if the body is sleeping.
    if (this.m_awakeFlag) {
      this.m_linearVelocity.x += this.m_invMass * impulse.x
      this.m_linearVelocity.y += this.m_invMass * impulse.y
      this.m_angularVelocity +=
        this.m_invI *
        ((point.x - this.m_sweep.c.x) * impulse.y -
          (point.y - this.m_sweep.c.y) * impulse.x)
    }
  }

  /// Apply an impulse at the center of gravity. This immediately modifies the velocity.
  /// @param impulse the world impulse vector, usually in N-seconds or kg-m/s.
  /// @param wake also wake up the body
  ApplyLinearImpulseToCenter(impulse: XY, wake = true): void {
    if (this.m_type !== BodyType.dynamicBody) {
      return
    }

    if (wake && !this.m_awakeFlag) {
      this.SetAwake(true)
    }

    // Don't accumulate a force if the body is sleeping.
    if (this.m_awakeFlag) {
      this.m_linearVelocity.x += this.m_invMass * impulse.x
      this.m_linearVelocity.y += this.m_invMass * impulse.y
    }
  }

  /// Apply an angular impulse.
  /// @param impulse the angular impulse in units of kg*m*m/s
  /// @param wake also wake up the body
  ApplyAngularImpulse(impulse: number, wake = true): void {
    if (this.m_type !== BodyType.dynamicBody) {
      return
    }

    if (wake && !this.m_awakeFlag) {
      this.SetAwake(true)
    }

    // Don't accumulate a force if the body is sleeping.
    if (this.m_awakeFlag) {
      this.m_angularVelocity += this.m_invI * impulse
    }
  }

  /// Get the total mass of the body.
  /// @return the mass, usually in kilograms (kg).
  GetMass(): number {
    return this.m_mass
  }

  /// Get the rotational inertia of the body about the local origin.
  /// @return the rotational inertia, usually in kg-m^2.
  GetInertia(): number {
    return (
      this.m_I +
      this.m_mass *
        Vec2.DotVV(this.m_sweep.localCenter, this.m_sweep.localCenter)
    )
  }

  /// Get the mass data of the body.
  /// @return a struct containing the mass, inertia and center of the body.
  GetMassData(data: MassData): MassData {
    data.mass = this.m_mass
    data.I =
      this.m_I +
      this.m_mass *
        Vec2.DotVV(this.m_sweep.localCenter, this.m_sweep.localCenter)
    data.center.Copy(this.m_sweep.localCenter)
    return data
  }
  SetMassData(massData: MassData): void {
    if (this.m_world.IsLocked()) {
      throw new Error()
    }

    if (this.m_type !== BodyType.dynamicBody) {
      return
    }

    this.m_invMass = 0
    this.m_I = 0
    this.m_invI = 0

    this.m_mass = massData.mass
    if (this.m_mass <= 0) {
      this.m_mass = 1
    }

    this.m_invMass = 1 / this.m_mass

    if (massData.I > 0 && !this.m_fixedRotationFlag) {
      this.m_I =
        massData.I - this.m_mass * Vec2.DotVV(massData.center, massData.center)
      // DEBUG: Assert(this.m_I > 0);
      this.m_invI = 1 / this.m_I
    }

    // Move center of mass.
    const oldCenter: Vec2 = Body.SetMassData_s_oldCenter.Copy(this.m_sweep.c)
    this.m_sweep.localCenter.Copy(massData.center)
    Transform.MulXV(this.m_xf, this.m_sweep.localCenter, this.m_sweep.c)
    this.m_sweep.c0.Copy(this.m_sweep.c)

    // Update center of mass velocity.
    Vec2.AddVCrossSV(
      this.m_linearVelocity,
      this.m_angularVelocity,
      Vec2.SubVV(this.m_sweep.c, oldCenter, Vec2.s_t0),
      this.m_linearVelocity
    )
  }
  ResetMassData(): void {
    // Compute mass data from shapes. Each shape has its own density.
    this.m_mass = 0
    this.m_invMass = 0
    this.m_I = 0
    this.m_invI = 0
    this.m_sweep.localCenter.SetZero()

    // Static and kinematic bodies have zero mass.
    if (
      this.m_type === BodyType.staticBody ||
      this.m_type === BodyType.kinematicBody
    ) {
      this.m_sweep.c0.Copy(this.m_xf.p)
      this.m_sweep.c.Copy(this.m_xf.p)
      this.m_sweep.a0 = this.m_sweep.a
      return
    }

    // DEBUG: Assert(this.m_type === BodyType.dynamicBody);

    // Accumulate mass over all fixtures.
    const localCenter: Vec2 = Body.ResetMassData_s_localCenter.SetZero()
    for (let f: Fixture | null = this.m_fixtureList; f; f = f.m_next) {
      if (f.m_density === 0) {
        continue
      }

      const massData: MassData = f.GetMassData(Body.ResetMassData_s_massData)
      this.m_mass += massData.mass
      localCenter.x += massData.center.x * massData.mass
      localCenter.y += massData.center.y * massData.mass
      this.m_I += massData.I
    }

    // Compute center of mass.
    if (this.m_mass > 0) {
      this.m_invMass = 1 / this.m_mass
      localCenter.x *= this.m_invMass
      localCenter.y *= this.m_invMass
    } else {
      // Force all dynamic bodies to have a positive mass.
      this.m_mass = 1
      this.m_invMass = 1
    }

    if (this.m_I > 0 && !this.m_fixedRotationFlag) {
      // Center the inertia about the center of mass.
      this.m_I -= this.m_mass * Vec2.DotVV(localCenter, localCenter)
      // DEBUG: Assert(this.m_I > 0);
      this.m_invI = 1 / this.m_I
    } else {
      this.m_I = 0
      this.m_invI = 0
    }

    // Move center of mass.
    const oldCenter: Vec2 = Body.ResetMassData_s_oldCenter.Copy(this.m_sweep.c)
    this.m_sweep.localCenter.Copy(localCenter)
    Transform.MulXV(this.m_xf, this.m_sweep.localCenter, this.m_sweep.c)
    this.m_sweep.c0.Copy(this.m_sweep.c)

    // Update center of mass velocity.
    Vec2.AddVCrossSV(
      this.m_linearVelocity,
      this.m_angularVelocity,
      Vec2.SubVV(this.m_sweep.c, oldCenter, Vec2.s_t0),
      this.m_linearVelocity
    )
  }

  /// Get the world coordinates of a point given the local coordinates.
  /// @param localPoint a point on the body measured relative the the body's origin.
  /// @return the same point expressed in world coordinates.
  GetWorldPoint<T extends XY>(localPoint: XY, out: T): T {
    return Transform.MulXV(this.m_xf, localPoint, out)
  }

  /// Get the world coordinates of a vector given the local coordinates.
  /// @param localVector a vector fixed in the body.
  /// @return the same vector expressed in world coordinates.
  GetWorldVector<T extends XY>(localVector: XY, out: T): T {
    return Rot.MulRV(this.m_xf.q, localVector, out)
  }

  /// Gets a local point relative to the body's origin given a world point.
  /// @param a point in world coordinates.
  /// @return the corresponding local point relative to the body's origin.
  GetLocalPoint<T extends XY>(worldPoint: XY, out: T): T {
    return Transform.MulTXV(this.m_xf, worldPoint, out)
  }

  /// Gets a local vector given a world vector.
  /// @param a vector in world coordinates.
  /// @return the corresponding local vector.
  GetLocalVector<T extends XY>(worldVector: XY, out: T): T {
    return Rot.MulTRV(this.m_xf.q, worldVector, out)
  }

  /// Get the world linear velocity of a world point attached to this body.
  /// @param a point in world coordinates.
  /// @return the world velocity of a point.
  GetLinearVelocityFromWorldPoint<T extends XY>(worldPoint: XY, out: T): T {
    return Vec2.AddVCrossSV(
      this.m_linearVelocity,
      this.m_angularVelocity,
      Vec2.SubVV(worldPoint, this.m_sweep.c, Vec2.s_t0),
      out
    )
  }

  /// Get the world velocity of a local point.
  /// @param a point in local coordinates.
  /// @return the world velocity of a point.
  GetLinearVelocityFromLocalPoint<T extends XY>(localPoint: XY, out: T): T {
    return this.GetLinearVelocityFromWorldPoint(
      this.GetWorldPoint(localPoint, out),
      out
    )
  }

  /// Get the linear damping of the body.
  GetLinearDamping(): number {
    return this.m_linearDamping
  }

  /// Set the linear damping of the body.
  SetLinearDamping(linearDamping: number): void {
    this.m_linearDamping = linearDamping
  }

  /// Get the angular damping of the body.
  GetAngularDamping(): number {
    return this.m_angularDamping
  }

  /// Set the angular damping of the body.
  SetAngularDamping(angularDamping: number): void {
    this.m_angularDamping = angularDamping
  }

  /// Get the gravity scale of the body.
  GetGravityScale(): number {
    return this.m_gravityScale
  }

  /// Set the gravity scale of the body.
  SetGravityScale(scale: number): void {
    this.m_gravityScale = scale
  }

  /// Set the type of this body. This may alter the mass and velocity.
  SetType(type: BodyType): void {
    if (this.m_world.IsLocked()) {
      throw new Error()
    }

    if (this.m_type === type) {
      return
    }

    this.m_type = type

    this.ResetMassData()

    if (this.m_type === BodyType.staticBody) {
      this.m_linearVelocity.SetZero()
      this.m_angularVelocity = 0
      this.m_sweep.a0 = this.m_sweep.a
      this.m_sweep.c0.Copy(this.m_sweep.c)
      this.SynchronizeFixtures()
    }

    this.SetAwake(true)

    this.m_force.SetZero()
    this.m_torque = 0

    // Delete the attached contacts.
    let ce: ContactEdge | null = this.m_contactList
    while (ce) {
      const ce0: ContactEdge = ce
      ce = ce.next
      this.m_world.m_contactManager.Destroy(ce0.contact)
    }
    this.m_contactList = null

    // Touch the proxies so that new contacts will be created (when appropriate)
    for (let f: Fixture | null = this.m_fixtureList; f; f = f.m_next) {
      f.TouchProxies()
    }
  }

  /// Get the type of this body.
  GetType(): BodyType {
    return this.m_type
  }

  /// Should this body be treated like a bullet for continuous collision detection?
  SetBullet(flag: boolean): void {
    this.m_bulletFlag = flag
  }

  /// Is this body treated like a bullet for continuous collision detection?
  IsBullet(): boolean {
    return this.m_bulletFlag
  }

  /// You can disable sleeping on this body. If you disable sleeping, the
  /// body will be woken.
  SetSleepingAllowed(flag: boolean): void {
    this.m_autoSleepFlag = flag
    if (!flag) {
      this.SetAwake(true)
    }
  }

  /// Is this body allowed to sleep
  IsSleepingAllowed(): boolean {
    return this.m_autoSleepFlag
  }

  /// Set the sleep state of the body. A sleeping body has very
  /// low CPU cost.
  /// @param flag set to true to wake the body, false to put it to sleep.
  SetAwake(flag: boolean): void {
    if (flag) {
      this.m_awakeFlag = true
      this.m_sleepTime = 0
    } else {
      this.m_awakeFlag = false
      this.m_sleepTime = 0
      this.m_linearVelocity.SetZero()
      this.m_angularVelocity = 0
      this.m_force.SetZero()
      this.m_torque = 0
    }
  }

  /// Get the sleeping state of this body.
  /// @return true if the body is sleeping.
  IsAwake(): boolean {
    return this.m_awakeFlag
  }

  /// Set the active state of the body. An inactive body is not
  /// simulated and cannot be collided with or woken up.
  /// If you pass a flag of true, all fixtures will be added to the
  /// broad-phase.
  /// If you pass a flag of false, all fixtures will be removed from
  /// the broad-phase and all contacts will be destroyed.
  /// Fixtures and joints are otherwise unaffected. You may continue
  /// to create/destroy fixtures and joints on inactive bodies.
  /// Fixtures on an inactive body are implicitly inactive and will
  /// not participate in collisions, ray-casts, or queries.
  /// Joints connected to an inactive body are implicitly inactive.
  /// An inactive body is still owned by a World object and remains
  /// in the body list.
  SetActive(flag: boolean): void {
    if (this.m_world.IsLocked()) {
      throw new Error()
    }

    if (flag === this.IsActive()) {
      return
    }

    this.m_activeFlag = flag

    if (flag) {
      // Create all proxies.
      for (let f: Fixture | null = this.m_fixtureList; f; f = f.m_next) {
        f.CreateProxies(this.m_xf)
      }
      // Contacts are created the next time step.
    } else {
      // Destroy all proxies.
      for (let f: Fixture | null = this.m_fixtureList; f; f = f.m_next) {
        f.DestroyProxies()
      }
      // Destroy the attached contacts.
      let ce: ContactEdge | null = this.m_contactList
      while (ce) {
        const ce0: ContactEdge = ce
        ce = ce.next
        this.m_world.m_contactManager.Destroy(ce0.contact)
      }
      this.m_contactList = null
    }
  }

  /// Get the active state of the body.
  IsActive(): boolean {
    return this.m_activeFlag
  }

  /// Set this body to have fixed rotation. This causes the mass
  /// to be reset.
  SetFixedRotation(flag: boolean): void {
    if (this.m_fixedRotationFlag === flag) {
      return
    }

    this.m_fixedRotationFlag = flag

    this.m_angularVelocity = 0

    this.ResetMassData()
  }

  /// Does this body have fixed rotation?
  IsFixedRotation(): boolean {
    return this.m_fixedRotationFlag
  }

  /// Get the list of all fixtures attached to this body.
  GetFixtureList(): Fixture | null {
    return this.m_fixtureList
  }

  /// Get the list of all joints attached to this body.
  GetJointList(): JointEdge | null {
    return this.m_jointList
  }

  /// Get the list of all contacts attached to this body.
  /// @warning this list changes during the time step and you may
  /// miss some collisions if you don't use ContactListener.
  GetContactList(): ContactEdge | null {
    return this.m_contactList
  }

  /// Get the next body in the world's body list.
  GetNext(): Body | null {
    return this.m_next
  }

  /// Get the user data pointer that was provided in the body definition.
  GetUserData(): any {
    return this.m_userData
  }

  /// Set the user data. Use this to store your application specific data.
  SetUserData(data: any): void {
    this.m_userData = data
  }

  /// Get the parent world of this body.
  GetWorld(): World {
    return this.m_world
  }

  /// Dump this body to a log file
  Dump(log: (format: string, ...args: any[]) => void): void {
    const bodyIndex: number = this.m_islandIndex

    log('{\n')
    log('  const bd: BodyDef = new BodyDef();\n')
    let type_str = ''
    switch (this.m_type) {
      case BodyType.staticBody:
        type_str = 'BodyType.staticBody'
        break
      case BodyType.kinematicBody:
        type_str = 'BodyType.kinematicBody'
        break
      case BodyType.dynamicBody:
        type_str = 'BodyType.dynamicBody'
        break
      default:
        // DEBUG: Assert(false);
        break
    }
    log('  bd.type = %s;\n', type_str)
    log('  bd.position.Set(%.15f, %.15f);\n', this.m_xf.p.x, this.m_xf.p.y)
    log('  bd.angle = %.15f;\n', this.m_sweep.a)
    log(
      '  bd.linearVelocity.Set(%.15f, %.15f);\n',
      this.m_linearVelocity.x,
      this.m_linearVelocity.y
    )
    log('  bd.angularVelocity = %.15f;\n', this.m_angularVelocity)
    log('  bd.linearDamping = %.15f;\n', this.m_linearDamping)
    log('  bd.angularDamping = %.15f;\n', this.m_angularDamping)
    log('  bd.allowSleep = %s;\n', this.m_autoSleepFlag ? 'true' : 'false')
    log('  bd.awake = %s;\n', this.m_awakeFlag ? 'true' : 'false')
    log(
      '  bd.fixedRotation = %s;\n',
      this.m_fixedRotationFlag ? 'true' : 'false'
    )
    log('  bd.bullet = %s;\n', this.m_bulletFlag ? 'true' : 'false')
    log('  bd.active = %s;\n', this.m_activeFlag ? 'true' : 'false')
    log('  bd.gravityScale = %.15f;\n', this.m_gravityScale)
    log('\n')
    log('  bodies[%d] = this.m_world.CreateBody(bd);\n', this.m_islandIndex)
    log('\n')
    for (let f: Fixture | null = this.m_fixtureList; f; f = f.m_next) {
      log('  {\n')
      f.Dump(log, bodyIndex)
      log('  }\n')
    }
    log('}\n')
  }
  SynchronizeFixtures(): void {
    const xf1: Transform = Body.SynchronizeFixtures_s_xf1
    xf1.q.SetAngle(this.m_sweep.a0)
    Rot.MulRV(xf1.q, this.m_sweep.localCenter, xf1.p)
    Vec2.SubVV(this.m_sweep.c0, xf1.p, xf1.p)

    for (let f: Fixture | null = this.m_fixtureList; f; f = f.m_next) {
      f.Synchronize(xf1, this.m_xf)
    }
  }

  SynchronizeTransform(): void {
    this.m_xf.q.SetAngle(this.m_sweep.a)
    Rot.MulRV(this.m_xf.q, this.m_sweep.localCenter, this.m_xf.p)
    Vec2.SubVV(this.m_sweep.c, this.m_xf.p, this.m_xf.p)
  }

  // This is used to prevent connected bodies from colliding.
  // It may lie, depending on the collideConnected flag.
  ShouldCollide(other: Body): boolean {
    // At least one body should be dynamic or kinematic.
    if (
      this.m_type === BodyType.staticBody &&
      other.m_type === BodyType.staticBody
    ) {
      return false
    }
    return this.ShouldCollideConnected(other)
  }

  ShouldCollideConnected(other: Body): boolean {
    // Does a joint prevent collision?
    for (let jn: JointEdge | null = this.m_jointList; jn; jn = jn.next) {
      if (jn.other === other) {
        if (!jn.joint.m_collideConnected) {
          return false
        }
      }
    }

    return true
  }

  Advance(alpha: number): void {
    // Advance to the new safe time. This doesn't sync the broad-phase.
    this.m_sweep.Advance(alpha)
    this.m_sweep.c.Copy(this.m_sweep.c0)
    this.m_sweep.a = this.m_sweep.a0
    this.m_xf.q.SetAngle(this.m_sweep.a)
    Rot.MulRV(this.m_xf.q, this.m_sweep.localCenter, this.m_xf.p)
    Vec2.SubVV(this.m_sweep.c, this.m_xf.p, this.m_xf.p)
  }

  // #if ENABLE_CONTROLLER
  GetControllerList(): ControllerEdge | null {
    return this.m_controllerList
  }

  GetControllerCount(): number {
    return this.m_controllerCount
  }
  // #endif
}
